<?php
/**
 * WooCommerce gateway: pay an order in USDC through SettleKit.
 *
 * Flow (ported from btcpayserver/woocommerce-greenfield-plugin, MIT; see
 * NOTICE): process_payment() reuses the order's open SettleKit payment or
 * creates one (a payment request for the order total), then redirects the
 * buyer to SettleKit's hosted checkout, which returns them to the order
 * received page. The signed `invoice.paid` webhook completes the order; the
 * thank-you page also checks the payment status in case the webhook is late.
 */

defined( 'ABSPATH' ) || exit();

class WC_Gateway_SettleKit extends WC_Payment_Gateway {
	const META_INVOICE_ID = '_settlekit_invoice_id';
	const META_PAY_URL    = '_settlekit_pay_url';
	const META_TX_HASH    = '_settlekit_tx_hash';

	public function __construct() {
		$this->id                 = 'settlekit';
		$this->method_title       = __( 'SettleKit (USDC)', 'settlekit-for-woocommerce' );
		$this->method_description = __( 'Accept USDC and other stablecoins on the networks you enable in SettleKit. Funds go straight to your wallet.', 'settlekit-for-woocommerce' );
		$this->has_fields         = false;
		$this->order_button_text  = __( 'Pay with USDC', 'settlekit-for-woocommerce' );
		$this->supports           = [ 'products' ];

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = $this->get_option( 'title', __( 'USDC', 'settlekit-for-woocommerce' ) );
		$this->description = $this->get_option( 'description', __( 'Pay with USDC from your wallet. You will be taken to a secure checkout.', 'settlekit-for-woocommerce' ) );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, [ $this, 'process_admin_options' ] );
		add_action( 'woocommerce_api_settlekit', [ $this, 'handle_webhook' ] );
		add_action( 'woocommerce_thankyou_' . $this->id, [ $this, 'check_on_thankyou' ] );
	}

	public function init_form_fields() {
		$this->form_fields = [
			'enabled'        => [
				'title'   => __( 'Enable', 'settlekit-for-woocommerce' ),
				'type'    => 'checkbox',
				'label'   => __( 'Accept USDC with SettleKit', 'settlekit-for-woocommerce' ),
				'default' => 'no',
			],
			'title'          => [
				'title'   => __( 'Title', 'settlekit-for-woocommerce' ),
				'type'    => 'text',
				'default' => __( 'USDC', 'settlekit-for-woocommerce' ),
			],
			'description'    => [
				'title'   => __( 'Description', 'settlekit-for-woocommerce' ),
				'type'    => 'textarea',
				'default' => __( 'Pay with USDC from your wallet. You will be taken to a secure checkout.', 'settlekit-for-woocommerce' ),
			],
			'api_url'        => [
				'title'       => __( 'SettleKit API URL', 'settlekit-for-woocommerce' ),
				'type'        => 'text',
				'description' => __( 'For example https://api.settlekit.dev', 'settlekit-for-woocommerce' ),
				'default'     => '',
			],
			'api_key'        => [
				'title'       => __( 'API key', 'settlekit-for-woocommerce' ),
				'type'        => 'password',
				'description' => __( 'Create one in the SettleKit dashboard under API keys.', 'settlekit-for-woocommerce' ),
				'default'     => '',
			],
			'webhook_secret' => [
				'title'       => __( 'Webhook signing secret', 'settlekit-for-woocommerce' ),
				'type'        => 'password',
				'description' => sprintf(
					/* translators: %s: webhook URL */
					__( 'In SettleKit, add a webhook endpoint %s subscribed to invoice.paid and paste its secret here.', 'settlekit-for-woocommerce' ),
					'<code>' . esc_html( home_url( '/?wc-api=settlekit' ) ) . '</code>'
				),
				'default'     => '',
			],
		];
	}

	private function api(): SettleKit_Api {
		return new SettleKit_Api( (string) $this->get_option( 'api_url' ), (string) $this->get_option( 'api_key' ) );
	}

	/** Only offer the gateway for USD-priced carts (USDC settles 1:1). */
	public function is_available() {
		return parent::is_available() && get_woocommerce_currency() === 'USD' && $this->api()->configured();
	}

	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			throw new \Exception( __( 'Order not found.', 'settlekit-for-woocommerce' ) );
		}
		$api = $this->api();

		// Reuse an open payment for this order (buyer came back to checkout).
		$invoice_id = (string) $order->get_meta( self::META_INVOICE_ID );
		$pay_url    = (string) $order->get_meta( self::META_PAY_URL );
		if ( $invoice_id !== '' && $pay_url !== '' ) {
			try {
				$invoice = $api->get_invoice( $invoice_id );
				if ( ( $invoice['status'] ?? '' ) === 'open' ) {
					return [ 'result' => 'success', 'redirect' => $pay_url ];
				}
			} catch ( \Throwable $e ) {
				wc_get_logger()->warning( 'SettleKit: could not reuse payment ' . $invoice_id . ': ' . $e->getMessage(), [ 'source' => 'settlekit' ] );
			}
		}

		try {
			$created = $api->create_payment_request(
				[
					'amount'      => wc_format_decimal( $order->get_total(), 2 ),
					'description' => sprintf( 'Order #%s from %s', $order->get_order_number(), get_bloginfo( 'name' ) ),
					'payerEmail'  => $order->get_billing_email(),
					'sendEmail'   => false,
					'successUrl'  => $this->get_return_url( $order ),
					'metadata'    => [
						'source'      => 'woocommerce',
						'wc_order_id' => (string) $order->get_id(),
						'store'       => home_url(),
					],
				]
			);
		} catch ( \Throwable $e ) {
			wc_get_logger()->error( 'SettleKit: payment request failed: ' . $e->getMessage(), [ 'source' => 'settlekit' ] );
			throw new \Exception( __( 'Could not start the USDC payment. Please try again or choose another method.', 'settlekit-for-woocommerce' ) );
		}

		$order->update_meta_data( self::META_INVOICE_ID, (string) $created['invoice']['id'] );
		$order->update_meta_data( self::META_PAY_URL, (string) $created['payUrl'] );
		$order->update_status( 'pending', __( 'Awaiting USDC payment through SettleKit.', 'settlekit-for-woocommerce' ) );
		$order->save();

		return [ 'result' => 'success', 'redirect' => (string) $created['payUrl'] ];
	}

	/** Mark an order paid from a verified settlement (idempotent). */
	public function complete_order( WC_Order $order, string $tx_hash, string $network ) {
		if ( $order->is_paid() ) {
			return;
		}
		if ( $tx_hash !== '' ) {
			$order->update_meta_data( self::META_TX_HASH, $tx_hash );
		}
		$order->add_order_note(
			sprintf(
				/* translators: 1: network, 2: transaction hash */
				__( 'USDC payment settled on %1$s. Transaction %2$s.', 'settlekit-for-woocommerce' ),
				$network !== '' ? $network : 'chain',
				$tx_hash !== '' ? $tx_hash : '-'
			)
		);
		$order->payment_complete( $tx_hash );
	}

	/** ?wc-api=settlekit: signed SettleKit webhook. */
	public function handle_webhook() {
		$raw    = (string) file_get_contents( 'php://input' );
		$header = isset( $_SERVER['HTTP_SETTLEKIT_SIGNATURE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SETTLEKIT_SIGNATURE'] ) ) : '';
		if ( ! SettleKit_Webhook::verify( (string) $this->get_option( 'webhook_secret' ), $raw, $header ) ) {
			status_header( 400 );
			exit( 'invalid signature' );
		}
		$event = SettleKit_Webhook::parse_event( $raw );
		if ( $event === null || $event['type'] !== 'invoice.paid' ) {
			status_header( 200 );
			exit( 'ignored' );
		}
		$invoice_id = (string) ( $event['data']['invoiceId'] ?? '' );
		$orders     = wc_get_orders(
			[
				'limit'      => 2,
				'meta_key'   => self::META_INVOICE_ID,
				'meta_value' => $invoice_id,
			]
		);
		if ( count( $orders ) !== 1 ) {
			// 200 so SettleKit does not retry a payment this store does not own.
			status_header( 200 );
			exit( 'no matching order' );
		}
		$order    = $orders[0];
		$decision = SettleKit_Webhook::decide( $event, (string) $order->get_meta( self::META_INVOICE_ID ), (string) $order->get_total(), $order->is_paid() );
		if ( $decision === 'complete' ) {
			$this->complete_order( $order, (string) ( $event['data']['txHash'] ?? '' ), (string) ( $event['data']['network'] ?? '' ) );
		} elseif ( strpos( $decision, 'error:' ) === 0 ) {
			$order->add_order_note( 'SettleKit webhook not applied: ' . substr( $decision, 6 ) );
		}
		status_header( 200 );
		exit( 'ok' );
	}

	/** Order received page: settle now if SettleKit already confirmed it. */
	public function check_on_thankyou( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order || $order->is_paid() ) {
			return;
		}
		$invoice_id = (string) $order->get_meta( self::META_INVOICE_ID );
		if ( $invoice_id === '' ) {
			return;
		}
		try {
			$invoice = $this->api()->get_invoice( $invoice_id );
		} catch ( \Throwable $e ) {
			wc_get_logger()->warning( 'SettleKit: status check failed: ' . $e->getMessage(), [ 'source' => 'settlekit' ] );
			return;
		}
		$paid = ( $invoice['status'] ?? '' ) === 'paid';
		$total_ok = SettleKit_Webhook::covers( (string) ( $invoice['total']['amount'] ?? '' ), (string) $order->get_total() );
		if ( $paid && $total_ok ) {
			$meta = is_array( $invoice['metadata'] ?? null ) ? $invoice['metadata'] : [];
			$this->complete_order( $order, (string) ( $meta['paidTxHash'] ?? '' ), (string) ( $meta['paidNetwork'] ?? '' ) );
		}
	}
}

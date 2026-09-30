<?php
/**
 * Plugin Name:       SettleKit for WooCommerce
 * Plugin URI:        https://settlekit.dev
 * Description:       Accept USDC on the networks you enable in SettleKit. Buyers pay from their wallet, funds land in yours, and orders complete automatically once the payment is verified onchain.
 * Version:           0.1.0
 * Author:            SettleKit
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Text Domain:       settlekit-for-woocommerce
 * Requires PHP:      8.0
 * Requires at least: 6.2
 * Requires Plugins:  woocommerce
 * WC requires at least: 7.0
 */

defined( 'ABSPATH' ) || exit();

define( 'SETTLEKIT_WC_VERSION', '0.1.0' );

add_action(
	'plugins_loaded',
	function () {
		if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
			return;
		}
		require_once __DIR__ . '/includes/class-settlekit-webhook.php';
		require_once __DIR__ . '/includes/class-settlekit-api.php';
		require_once __DIR__ . '/includes/class-wc-gateway-settlekit.php';

		add_filter(
			'woocommerce_payment_gateways',
			function ( $gateways ) {
				$gateways[] = 'WC_Gateway_SettleKit';
				return $gateways;
			}
		);
	}
);

// Declare compatibility with WooCommerce order storage (HPOS): the gateway
// only uses the WC_Order CRUD API and wc_get_orders().
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

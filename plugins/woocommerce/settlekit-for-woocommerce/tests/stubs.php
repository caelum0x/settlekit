<?php
/**
 * Minimal WordPress / WooCommerce stand-ins so the gateway runs under plain
 * PHP CLI (pattern from the upstream plugin's tests/standalone).
 */
define( 'ABSPATH', __DIR__ );
define( 'SETTLEKIT_STANDALONE_TESTS', true );

$GLOBALS['sk_http']   = [];   // queued responses
$GLOBALS['sk_calls']  = [];   // recorded requests
$GLOBALS['sk_orders'] = [];   // id => WC_Order
$GLOBALS['sk_currency'] = 'USD';

function __( $text, $domain = null ) { return $text; }
function esc_html( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES ); }
function home_url( $path = '' ) { return 'https://store.test' . $path; }
function get_bloginfo( $what ) { return 'Test Store'; }
function wc_format_decimal( $value, $dp ) { return number_format( (float) $value, $dp, '.', '' ); }
function get_woocommerce_currency() { return $GLOBALS['sk_currency']; }
function wp_json_encode( $data ) { return json_encode( $data ); }
function add_action( ...$args ) {}
function add_filter( ...$args ) {}
function sanitize_text_field( $v ) { return trim( (string) $v ); }
function wp_unslash( $v ) { return $v; }
function status_header( $code ) { $GLOBALS['sk_status'] = $code; }
function is_wp_error( $v ) { return $v instanceof WP_Error; }
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
function wp_remote_request( $url, $args ) {
	$GLOBALS['sk_calls'][] = [ 'url' => $url, 'args' => $args ];
	$next = array_shift( $GLOBALS['sk_http'] );
	if ( $next === null ) { return new WP_Error( 'no response queued' ); }
	return $next;
}
function wc_get_logger() {
	return new class() {
		public array $lines = [];
		public function __call( $name, $args ) { $this->lines[] = $name . ': ' . $args[0]; }
	};
}
function wc_get_order( $id ) { return $GLOBALS['sk_orders'][ $id ] ?? false; }
function wc_get_orders( $query ) {
	$out = [];
	foreach ( $GLOBALS['sk_orders'] as $order ) {
		if ( $order->get_meta( $query['meta_key'] ) === $query['meta_value'] ) { $out[] = $order; }
	}
	return $out;
}

class WP_Error {
	public function __construct( private string $message ) {}
	public function get_error_message() { return $this->message; }
}

class WC_Payment_Gateway {
	public $id; public $title; public $description; public $method_title; public $method_description;
	public $has_fields; public $order_button_text; public $supports = []; public $form_fields = [];
	public $settings = [];
	public function init_settings() { $this->settings = $GLOBALS['sk_settings'] ?? []; }
	public function get_option( $key, $default = '' ) { return $this->settings[ $key ] ?? $default; }
	public function get_return_url( $order ) { return 'https://store.test/checkout/order-received/' . $order->get_id(); }
	public function is_available() { return ( $this->settings['enabled'] ?? 'no' ) === 'yes'; }
	public function process_admin_options() {}
}

class WC_Order {
	public array $meta = [];
	public array $notes = [];
	public string $status = 'pending';
	public ?string $paid_tx = null;
	public function __construct( private int $id, private string $total, private string $email = 'shopper@store.test' ) {}
	public function get_id() { return $this->id; }
	public function get_order_number() { return (string) $this->id; }
	public function get_total() { return $this->total; }
	public function get_billing_email() { return $this->email; }
	public function get_meta( $key ) { return $this->meta[ $key ] ?? ''; }
	public function update_meta_data( $key, $value ) { $this->meta[ $key ] = $value; }
	public function update_status( $status, $note = '' ) { $this->status = $status; if ( $note ) { $this->notes[] = $note; } }
	public function add_order_note( $note ) { $this->notes[] = $note; }
	public function save() {}
	public function is_paid() { return in_array( $this->status, [ 'processing', 'completed' ], true ); }
	public function payment_complete( $tx = '' ) { $this->status = 'processing'; $this->paid_tx = $tx; }
}

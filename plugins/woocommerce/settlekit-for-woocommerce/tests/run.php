<?php
/**
 * Standalone tests: php tests/run.php  (exit code 0 = all passed)
 */
require __DIR__ . '/stubs.php';
require __DIR__ . '/../includes/class-settlekit-webhook.php';
require __DIR__ . '/../includes/class-settlekit-api.php';
require __DIR__ . '/../includes/class-wc-gateway-settlekit.php';

$failures = 0;
$count    = 0;
function check( string $name, bool $ok ) {
	global $failures, $count;
	$count++;
	if ( ! $ok ) { $failures++; fwrite( STDERR, "FAIL: $name\n" ); }
}
function ok_response( array $data, int $code = 200 ) { return [ 'code' => $code, 'body' => json_encode( [ 'data' => $data ] ) ]; }
function sign( string $secret, string $body, int $t ) { return 't=' . $t . ',v1=' . hash_hmac( 'sha256', $t . '.' . $body, $secret ); }

// --- signatures -----------------------------------------------------------
$secret = 'whsec_test_secret';
$body   = '{"id":"evt_1","type":"invoice.paid","data":{"invoiceId":"inv_1","amount":"42","txHash":"0xabc","network":"base"}}';
$now    = 1790000000;
check( 'valid signature', SettleKit_Webhook::verify( $secret, $body, sign( $secret, $body, $now ), 300, $now ) );
check( 'wrong secret', ! SettleKit_Webhook::verify( 'other', $body, sign( $secret, $body, $now ), 300, $now ) );
check( 'tampered body', ! SettleKit_Webhook::verify( $secret, $body . ' ', sign( $secret, $body, $now ), 300, $now ) );
check( 'stale signature', ! SettleKit_Webhook::verify( $secret, $body, sign( $secret, $body, $now - 301 ), 300, $now ) );
check( 'malformed header', ! SettleKit_Webhook::verify( $secret, $body, 'v1=abc', 300, $now ) );
check( 'empty secret refuses', ! SettleKit_Webhook::verify( '', $body, sign( '', $body, $now ), 300, $now ) );

// --- amounts and decisions ------------------------------------------------
check( 'micros', SettleKit_Webhook::to_micros( '42.5' ) === 42500000 );
check( 'micros rejects junk', SettleKit_Webhook::to_micros( '4e2' ) === null );
check( 'covers equal', SettleKit_Webhook::covers( '42', '42.00' ) );
check( 'short payment', ! SettleKit_Webhook::covers( '41.99', '42.00' ) );
$event = SettleKit_Webhook::parse_event( $body );
check( 'decide complete', SettleKit_Webhook::decide( $event, 'inv_1', '42.00', false ) === 'complete' );
check( 'decide already paid', SettleKit_Webhook::decide( $event, 'inv_1', '42.00', true ) === 'ignore' );
check( 'decide mismatch', SettleKit_Webhook::decide( $event, 'inv_2', '42.00', false ) === 'error:invoice mismatch' );
check( 'decide short', SettleKit_Webhook::decide( $event, 'inv_1', '50.00', false ) === 'error:amount below order total' );
check( 'decide other type', SettleKit_Webhook::decide( [ 'type' => 'payment.confirmed', 'data' => [] ], 'inv_1', '1', false ) === 'ignore' );
check( 'parse junk', SettleKit_Webhook::parse_event( 'nope' ) === null );

// --- gateway flow -----------------------------------------------------------
$GLOBALS['sk_settings'] = [ 'enabled' => 'yes', 'api_url' => 'https://api.settlekit.test/', 'api_key' => 'sk_live_x', 'webhook_secret' => $secret ];
$gateway = new WC_Gateway_SettleKit();
check( 'available for USD', $gateway->is_available() === true );
$GLOBALS['sk_currency'] = 'EUR';
check( 'hidden for EUR', $gateway->is_available() === false );
$GLOBALS['sk_currency'] = 'USD';

$order = new WC_Order( 1001, '42.00' );
$GLOBALS['sk_orders'][1001] = $order;
$GLOBALS['sk_http'][] = ok_response( [ 'invoice' => [ 'id' => 'inv_1', 'status' => 'open' ], 'payUrl' => 'https://pay.test/i/tok_abcdefghijklmnop' ], 201 );
$result = $gateway->process_payment( 1001 );
$call   = $GLOBALS['sk_calls'][0];
$sent   = json_decode( $call['args']['body'], true );
check( 'redirects to pay page', $result['redirect'] === 'https://pay.test/i/tok_abcdefghijklmnop' );
check( 'posts to payment requests', $call['url'] === 'https://api.settlekit.test/v1/invoices/requests' && $call['args']['method'] === 'POST' );
check( 'bearer auth', $call['args']['headers']['Authorization'] === 'Bearer sk_live_x' );
check( 'amount + no email + return url', $sent['amount'] === '42.00' && $sent['sendEmail'] === false && $sent['successUrl'] === 'https://store.test/checkout/order-received/1001' );
check( 'order meta stored', $order->get_meta( '_settlekit_invoice_id' ) === 'inv_1' );

// Returning to checkout reuses the open payment.
$GLOBALS['sk_http'][] = ok_response( [ 'id' => 'inv_1', 'status' => 'open' ] );
$again = $gateway->process_payment( 1001 );
check( 'reuses open payment', $again['redirect'] === 'https://pay.test/i/tok_abcdefghijklmnop' && count( $GLOBALS['sk_calls'] ) === 2 );

// API failure surfaces a buyer-safe error.
$broken = new WC_Order( 1002, '5.00' );
$GLOBALS['sk_orders'][1002] = $broken;
$GLOBALS['sk_http'][] = [ 'code' => 400, 'body' => json_encode( [ 'error' => [ 'message' => 'Add a receiving wallet' ] ] ) ];
try {
	$gateway->process_payment( 1002 );
	check( 'throws on API error', false );
} catch ( \Exception $e ) {
	check( 'throws on API error', strpos( $e->getMessage(), 'Could not start the USDC payment' ) === 0 );
}

// Thank-you page settles when SettleKit already confirmed it.
$GLOBALS['sk_http'][] = ok_response( [ 'id' => 'inv_1', 'status' => 'paid', 'total' => [ 'amount' => '42' ], 'metadata' => [ 'paidTxHash' => '0xabc', 'paidNetwork' => 'base' ] ] );
$gateway->check_on_thankyou( 1001 );
check( 'thank-you completes order', $order->is_paid() && $order->paid_tx === '0xabc' );

// Webhook decision on an already-paid order is a no-op.
$order2 = new WC_Order( 1003, '10.00' );
$order2->update_meta_data( '_settlekit_invoice_id', 'inv_3' );
$GLOBALS['sk_orders'][1003] = $order2;
$evt = SettleKit_Webhook::parse_event( '{"type":"invoice.paid","data":{"invoiceId":"inv_3","amount":"10","txHash":"0xdef","network":"solana"}}' );
check( 'webhook decides complete', SettleKit_Webhook::decide( $evt, 'inv_3', '10.00', false ) === 'complete' );
$gateway->complete_order( $order2, '0xdef', 'solana' );
$gateway->complete_order( $order2, '0xother', 'solana' );
check( 'complete is idempotent', $order2->paid_tx === '0xdef' && count( $order2->notes ) === 1 );

echo "$count checks, $failures failed\n";
exit( $failures === 0 ? 0 : 1 );

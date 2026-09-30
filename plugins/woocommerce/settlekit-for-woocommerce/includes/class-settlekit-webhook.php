<?php
/**
 * SettleKit webhook helpers with no WordPress dependency (unit-testable).
 *
 * SettleKit signs each delivery with `SettleKit-Signature: t=<unix>,v1=<hex>`
 * where v1 = HMAC-SHA256(secret, "<t>.<raw body>").
 */

defined( 'ABSPATH' ) || defined( 'SETTLEKIT_STANDALONE_TESTS' ) || exit();

final class SettleKit_Webhook {
	const SIGNATURE_HEADER = 'SettleKit-Signature';
	const DEFAULT_TOLERANCE = 300;

	/** Parse "t=..,v1=.." into [timestamp, signature] or null. */
	public static function parse_signature( string $header ): ?array {
		$timestamp = null;
		$signature = null;
		foreach ( explode( ',', $header ) as $part ) {
			$pair = explode( '=', trim( $part ), 2 );
			if ( count( $pair ) !== 2 ) {
				continue;
			}
			if ( $pair[0] === 't' && preg_match( '/^\d+$/', $pair[1] ) ) {
				$timestamp = (int) $pair[1];
			} elseif ( $pair[0] === 'v1' && preg_match( '/^[0-9a-f]+$/i', $pair[1] ) ) {
				$signature = strtolower( $pair[1] );
			}
		}
		if ( $timestamp === null || $signature === null ) {
			return null;
		}
		return [ $timestamp, $signature ];
	}

	/** Constant-time signature check with a freshness window (seconds). */
	public static function verify( string $secret, string $raw_body, string $header, int $tolerance = self::DEFAULT_TOLERANCE, ?int $now = null ): bool {
		if ( $secret === '' ) {
			return false;
		}
		$parsed = self::parse_signature( $header );
		if ( $parsed === null ) {
			return false;
		}
		[ $timestamp, $signature ] = $parsed;
		$now = $now ?? time();
		if ( $tolerance > 0 && abs( $now - $timestamp ) > $tolerance ) {
			return false;
		}
		$expected = hash_hmac( 'sha256', $timestamp . '.' . $raw_body, $secret );
		return hash_equals( $expected, $signature );
	}

	/** Decode an event body; null when it is not a SettleKit event. */
	public static function parse_event( string $raw_body ): ?array {
		$event = json_decode( $raw_body, true );
		if ( ! is_array( $event ) || ! isset( $event['type'], $event['data'] ) || ! is_string( $event['type'] ) || ! is_array( $event['data'] ) ) {
			return null;
		}
		return $event;
	}

	/** Decimal amount -> integer micro-units (USDC has 6 decimals). */
	public static function to_micros( string $amount ): ?int {
		$amount = trim( $amount );
		if ( ! preg_match( '/^(\d+)(?:\.(\d{1,6}))?$/', $amount, $m ) ) {
			return null;
		}
		$fraction = str_pad( $m[2] ?? '', 6, '0' );
		return (int) $m[1] * 1000000 + (int) $fraction;
	}

	/** Whether a paid amount covers the order total (both decimal strings). */
	public static function covers( string $paid, string $total ): bool {
		$p = self::to_micros( $paid );
		$t = self::to_micros( $total );
		return $p !== null && $t !== null && $p >= $t;
	}

	/**
	 * What to do with an event for an order: 'complete', 'ignore' or an error
	 * reason. Pure: the gateway applies the decision.
	 */
	public static function decide( array $event, string $order_invoice_id, string $order_total, bool $order_paid ): string {
		if ( $event['type'] !== 'invoice.paid' ) {
			return 'ignore';
		}
		$data = $event['data'];
		if ( ( $data['invoiceId'] ?? '' ) !== $order_invoice_id || $order_invoice_id === '' ) {
			return 'error:invoice mismatch';
		}
		if ( $order_paid ) {
			return 'ignore';
		}
		if ( ! self::covers( (string) ( $data['amount'] ?? '' ), $order_total ) ) {
			return 'error:amount below order total';
		}
		return 'complete';
	}
}

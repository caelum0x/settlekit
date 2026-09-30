<?php
/**
 * Minimal SettleKit API client over the WordPress HTTP API.
 *
 * Orders are charged as SettleKit payment requests: one amount and memo, a
 * hosted pay page, settlement verified onchain by SettleKit, and an
 * `invoice.paid` webhook when it settles.
 */

defined( 'ABSPATH' ) || exit();

final class SettleKit_Api {
	private string $base_url;
	private string $api_key;

	public function __construct( string $base_url, string $api_key ) {
		$this->base_url = rtrim( $base_url, '/' );
		$this->api_key  = $api_key;
	}

	public function configured(): bool {
		return $this->base_url !== '' && $this->api_key !== '';
	}

	/** POST /v1/invoices/requests; returns ['invoice' => [...], 'payUrl' => ...]. */
	public function create_payment_request( array $body ): array {
		return $this->request( 'POST', '/v1/invoices/requests', $body );
	}

	/** GET /v1/invoices/:id (reconciled: status turns "paid" once settled). */
	public function get_invoice( string $invoice_id ): array {
		return $this->request( 'GET', '/v1/invoices/' . rawurlencode( $invoice_id ) );
	}

	private function request( string $method, string $path, ?array $body = null ): array {
		$args = [
			'method'  => $method,
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $this->api_key,
				'Content-Type'  => 'application/json',
				'Accept'        => 'application/json',
			],
		];
		if ( $body !== null ) {
			$args['body'] = wp_json_encode( $body );
		}
		$response = wp_remote_request( $this->base_url . $path, $args );
		if ( is_wp_error( $response ) ) {
			throw new \RuntimeException( 'SettleKit is unreachable: ' . $response->get_error_message() );
		}
		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( $status < 200 || $status >= 300 || ! is_array( $decoded ) || ! isset( $decoded['data'] ) ) {
			$message = is_array( $decoded ) && isset( $decoded['error']['message'] ) ? (string) $decoded['error']['message'] : 'HTTP ' . $status;
			throw new \RuntimeException( 'SettleKit API error: ' . $message );
		}
		return $decoded['data'];
	}
}

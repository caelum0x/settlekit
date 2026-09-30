<?php
// Cross-language check: php tests/verify-cli.php <secret> <body-file> <header> <now>
define( 'SETTLEKIT_STANDALONE_TESTS', true );
require __DIR__ . '/../includes/class-settlekit-webhook.php';
[ , $secret, $body_file, $header, $now ] = $argv;
echo SettleKit_Webhook::verify( $secret, (string) file_get_contents( $body_file ), $header, 300, (int) $now ) ? 'valid' : 'invalid';

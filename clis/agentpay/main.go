// Command agentpay is a CLI that lets an AI agent discover and pay for SettleKit
// agent services and x402-protected APIs.
//
// Subcommands:
//
//	discover            list discoverable agent services + marketplace listings
//	metadata <id>       fetch a service's agent-readable metadata.json
//	call <url>          call a paid endpoint; pay a 402 challenge with --tx-hash
//
// Configuration comes from the environment:
//
//	SETTLEKIT_API_URL   API base URL (default http://localhost:8787)
//	SETTLEKIT_API_KEY   bearer token for authenticated endpoints
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"

	"github.com/settlekit/agentpay/internal/client"
	"github.com/settlekit/agentpay/internal/commands"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "agentpay: "+err.Error())
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || isHelp(args[0]) {
		commands.PrintUsage(os.Stdout)
		if len(args) == 0 {
			return errors.New("no command given")
		}
		return nil
	}

	name := args[0]
	cmd, ok := commands.Lookup(name)
	if !ok {
		commands.PrintUsage(os.Stderr)
		return fmt.Errorf("unknown command %q", name)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	api := client.New()
	return cmd.Run(ctx, api, args[1:], os.Stdout, os.Stderr)
}

func isHelp(arg string) bool {
	switch arg {
	case "-h", "--help", "help":
		return true
	default:
		return false
	}
}

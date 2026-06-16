// Package commands implements the agentpay subcommands: discover, metadata and
// call. Each subcommand is a self-contained flag.FlagSet handler so the CLI has
// no external dependencies beyond the standard library.
package commands

import (
	"context"
	"fmt"
	"io"

	"github.com/settlekit/agentpay/internal/client"
)

// Command is a single CLI subcommand.
type Command struct {
	Name    string
	Summary string
	// Run parses args (subcommand-specific flags) and executes. stdout/stderr
	// are injected for testability.
	Run func(ctx context.Context, api *client.Client, args []string, stdout, stderr io.Writer) error
}

// All returns every registered subcommand in display order.
func All() []Command {
	return []Command{
		discoverCommand(),
		metadataCommand(),
		callCommand(),
	}
}

// Lookup finds a command by name, returning ok=false when unknown.
func Lookup(name string) (Command, bool) {
	for _, cmd := range All() {
		if cmd.Name == name {
			return cmd, true
		}
	}
	return Command{}, false
}

// PrintUsage writes the top-level help text.
func PrintUsage(w io.Writer) {
	fmt.Fprintln(w, "agentpay — discover and pay for SettleKit agent services via x402")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  agentpay <command> [flags]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Commands:")
	for _, cmd := range All() {
		fmt.Fprintf(w, "  %-12s %s\n", cmd.Name, cmd.Summary)
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Environment:")
	fmt.Fprintln(w, "  SETTLEKIT_API_URL   API base URL (default http://localhost:8787)")
	fmt.Fprintln(w, "  SETTLEKIT_API_KEY   Bearer token for authenticated endpoints")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Run 'agentpay <command> -h' for command-specific flags.")
}

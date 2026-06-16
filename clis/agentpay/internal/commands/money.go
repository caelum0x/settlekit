package commands

import (
	"fmt"
	"math/big"
)

// parseDecimal parses a non-negative decimal money string (e.g. "25.00",
// "0.005") into an exact *big.Rat. It avoids float rounding so price filters are
// precise. An empty string is treated as an error by the caller.
func parseDecimal(s string) (*big.Rat, error) {
	r := new(big.Rat)
	if _, ok := r.SetString(s); !ok {
		return nil, fmt.Errorf("invalid decimal amount %q", s)
	}
	return r, nil
}

// withinMaxPrice reports whether price <= max. Both are decimal strings. A
// failure to parse the service price excludes it from the result (returns
// false) so malformed listings never pass a price filter.
func withinMaxPrice(price, max string) (bool, error) {
	maxRat, err := parseDecimal(max)
	if err != nil {
		return false, fmt.Errorf("parse --max-price: %w", err)
	}
	priceRat, err := parseDecimal(price)
	if err != nil {
		return false, nil
	}
	return priceRat.Cmp(maxRat) <= 0, nil
}

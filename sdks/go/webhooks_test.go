package settlekit

import (
	"fmt"
	"testing"
	"time"
)

func TestVerifySignatureAcceptsAnyV1DuringRotation(t *testing.T) {
	body := []byte(`{"id":"evt_1"}`)
	ts := time.Now().Unix()
	oldSig := ComputeSignature("whsec_old", body, ts)
	newSig := ComputeSignature("whsec_new", body, ts)
	// Both headers are "t=<ts>,v1=<hex>"; join the v1 parts like a rotation does.
	header := fmt.Sprintf("%s,%s", newSig, oldSig[len(fmt.Sprintf("t=%d,", ts)):])
	if !VerifySignature("whsec_old", body, header) {
		t.Fatal("old secret should verify during rotation")
	}
	if !VerifySignature("whsec_new", body, header) {
		t.Fatal("new secret should verify during rotation")
	}
	if VerifySignature("whsec_other", body, header) {
		t.Fatal("unrelated secret must not verify")
	}
	if VerifySignature("whsec_old", body, fmt.Sprintf("t=%d", ts)) {
		t.Fatal("header without v1 must not verify")
	}
}

package btserial

import "testing"

func TestParseInstance(t *testing.T) {
	mac, in, ok := parseInstance("8&2a3b4c5d&0&001B35A0F2C1_C00000000")
	if !ok || in || mac != "00:1B:35:A0:F2:C1" {
		t.Fatalf("outgoing = %q %v %v", mac, in, ok)
	}
	mac, in, ok = parseInstance("7&1f2e3d4c&0&000000000000_00000000")
	if !ok || !in || mac != "00:00:00:00:00:00" {
		t.Fatalf("incoming = %q %v %v", mac, in, ok)
	}
	if _, _, ok := parseInstance("8&2a3b4c5d&0&LOCALMFG"); ok {
		t.Fatal("parsed an instance with no address")
	}
}

func TestNormalizeMAC(t *testing.T) {
	for in, want := range map[string]string{
		"001b35a0f2c1":       "00:1B:35:A0:F2:C1",
		"00:1B:35:A0:F2:C1":  "00:1B:35:A0:F2:C1",
		" 00-1b-35-a0-f2-c1": "00:1B:35:A0:F2:C1",
		"00:1B:35:A0:F2":     "",
		"COM5":               "",
		"00:1B:35:A0:F2:CG":  "",
	} {
		if got := NormalizeMAC(in); got != want {
			t.Errorf("NormalizeMAC(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDeviceName(t *testing.T) {
	if got := deviceName([]byte("MPT-II\x00\x00garbage")); got != "MPT-II" {
		t.Fatalf("got %q", got)
	}
	if got := deviceName([]byte{0xff, 0xfe, 0}); got != "" {
		t.Fatalf("invalid UTF-8 = %q", got)
	}
	if got := (Port{MAC: "00:1B:35:A0:F2:C1"}).DisplayName(); got != "Impressora Bluetooth 00:1B:35:A0:F2:C1" {
		t.Fatalf("DisplayName = %q", got)
	}
}

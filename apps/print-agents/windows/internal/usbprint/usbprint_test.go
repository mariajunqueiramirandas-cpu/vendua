package usbprint

import (
	"slices"
	"testing"
)

func TestAddresses(t *testing.T) {
	devs := []Device{
		{VID: 0x0519, PID: 0x0001, Serial: "TM-20X 0042", Location: "5&1a&0&1"},
		{VID: 0x0416, PID: 0x5011, Location: "5&2b&0&3"},
		{VID: 0x0416, PID: 0x5011, Location: "5&2b&0&4"},
		{VID: 0x0fe6, PID: 0x811e, Location: "1-1.2"},
	}
	want := []string{"0519:0001:tm20x0042", "0416:5011:p52b03", "0416:5011:p52b04", "0fe6:811e"}
	if got := Addresses(devs); !slices.Equal(got, want) {
		t.Fatalf("Addresses = %q, want %q", got, want)
	}
}

func TestFind(t *testing.T) {
	serial := Device{Path: "a", VID: 0x0519, PID: 0x0001, Serial: "X1"}
	lone := Device{Path: "b", VID: 0x0fe6, PID: 0x811e, Location: "5&9&0&2"}
	for _, tc := range []struct {
		name string
		devs []Device
		addr string
		want string
	}{
		{"exact", []Device{serial, lone}, "0519:0001:x1", "a"},
		{"case and spaces", []Device{serial}, " 0519:0001:X1 ", "a"},
		{"model only", []Device{serial, lone}, "0fe6:811e", "b"},
		// recorded while an identical one was attached, now alone on another port
		{"moved lone serial-less", []Device{lone}, "0fe6:811e:p5907", "b"},
		{"other serial", []Device{serial}, "0519:0001:x2", ""},
		{"identical pair, unknown port", []Device{lone, {Path: "c", VID: 0x0fe6, PID: 0x811e, Location: "5&9&0&3"}}, "0fe6:811e:p5901", ""},
		{"absent", []Device{serial}, "04b8:0202", ""},
		{"garbage", []Device{serial}, "nope", ""},
	} {
		d, ok := Find(tc.devs, tc.addr)
		if ok != (tc.want != "") || d.Path != tc.want {
			t.Errorf("%s: Find(%q) = %q %v, want %q", tc.name, tc.addr, d.Path, ok, tc.want)
		}
	}
}

func TestName1284(t *testing.T) {
	for in, want := range map[string]string{
		"MFG:EPSON;CMD:ESC/POS;MDL:TM-T20II;CLS:PRINTER;": "EPSON TM-T20II",
		"MANUFACTURER:Elgin;MODEL:i9;COMMAND SET:ESC/POS": "Elgin i9",
		"MFG:Bematech;MDL:Bematech MP-4200 TH;":           "Bematech MP-4200 TH",
		"MDL:POS58\x00;":                                  "POS58",
		"":                                                "",
	} {
		if got := Name1284(in); got != want {
			t.Errorf("Name1284(%q) = %q, want %q", in, got, want)
		}
	}
	if got := (Device{VID: 0x0416, PID: 0x5011}).DisplayName(); got != "Impressora USB 0416:5011" {
		t.Errorf("DisplayName = %q", got)
	}
}

func TestPaperOut(t *testing.T) {
	if !PaperOut(0x38) || PaperOut(0x18) || PaperOut(0xff) {
		t.Fatal("PaperOut misreads the status byte")
	}
}

func TestParseWinInterface(t *testing.T) {
	const guid = "#{28d78fad-5a12-11d1-ae5b-0000f803a8c2}"
	w, ok := parseWinInterface(`\\?\usb#vid_0519&pid_0001#00000000001A` + guid)
	if !ok || w.VID != 0x0519 || w.PID != 0x0001 || w.Composite || w.Instance != `usb\vid_0519&pid_0001\00000000001A` {
		t.Fatalf("plain = %+v %v", w, ok)
	}
	if s := instanceSerial(w.Instance); s != "00000000001A" {
		t.Fatalf("serial = %q", s)
	}
	w, ok = parseWinInterface(`\\?\USB#VID_0FE6&PID_811E&MI_01#7&1a2b3c&0&0001` + guid)
	if !ok || !w.Composite || instanceSerial(w.Instance) != "" || instanceLocation(w.Instance) != "7&1a2b3c&0&0001" {
		t.Fatalf("composite = %+v %v", w, ok)
	}
	for _, bad := range []string{`\\?\HID#VID_0519&PID_0001#1` + guid, `\\?\USB#PID_0001#1` + guid, `\\?\USB#VID_XYZ&PID_0001#1` + guid, "COM3"} {
		if _, ok := parseWinInterface(bad); ok {
			t.Errorf("parsed %q", bad)
		}
	}
	if k := winRegistryKey(`\\?\usb#vid_0519&pid_0001#1` + guid); k != "##?#usb#vid_0519&pid_0001#1"+guid {
		t.Fatalf("registry key = %q", k)
	}
}

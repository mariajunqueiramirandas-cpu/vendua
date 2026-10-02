package tray

import (
	"bytes"
	"encoding/binary"
	"image/png"
	"testing"
)

func TestICOLayout(t *testing.T) {
	ico := ICO(Green)
	le := binary.LittleEndian
	if le.Uint16(ico[0:]) != 0 || le.Uint16(ico[2:]) != 1 || le.Uint16(ico[4:]) != 2 {
		t.Fatalf("bad ICONDIR % x", ico[:6])
	}
	for i, size := range []int{16, 32} {
		e := ico[6+16*i:]
		if int(e[0]) != size || int(e[1]) != size || le.Uint16(e[6:]) != 32 {
			t.Fatalf("entry %d = % x", i, e[:16])
		}
		n, off := le.Uint32(e[8:]), le.Uint32(e[12:])
		mask := (size + 31) / 32 * 4 * size
		if int(n) != 40+size*size*4+mask || int(off+n) > len(ico) {
			t.Fatalf("entry %d size %d offset %d (file %d)", i, n, off, len(ico))
		}
		hdr := ico[off:]
		if le.Uint32(hdr) != 40 || int32(le.Uint32(hdr[8:])) != int32(2*size) {
			t.Fatalf("entry %d header % x", i, hdr[:16])
		}
		// Bottom-up rows: the middle pixel is opaque green, the corner clear.
		px := func(x, y int) []byte {
			o := int(off) + 40 + ((size-1-y)*size+x)*4
			return ico[o : o+4]
		}
		if !bytes.Equal(px(size/2, size/2), []byte{Green.B, Green.G, Green.R, 0xff}) {
			t.Fatalf("center pixel % x", px(size/2, size/2))
		}
		if px(0, 0)[3] != 0 {
			t.Fatalf("corner alpha %d", px(0, 0)[3])
		}
	}
}

func TestPNG(t *testing.T) {
	img, err := png.Decode(bytes.NewReader(PNG(Red, 32)))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 32 || b.Dy() != 32 {
		t.Fatalf("bounds %v", b)
	}
}

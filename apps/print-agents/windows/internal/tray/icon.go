package tray

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
)

var (
	Green = color.NRGBA{0x16, 0xa3, 0x4a, 0xff}
	Amber = color.NRGBA{0xf5, 0x9e, 0x0b, 0xff}
	Red   = color.NRGBA{0xdc, 0x26, 0x26, 0xff}
)

// Circle draws an anti-aliased filled circle on a transparent square.
func Circle(c color.NRGBA, size int) *image.NRGBA {
	const ss = 4 // supersamples per axis
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	center := float64(size) / 2
	r := center - 1
	for y := range size {
		for x := range size {
			hits := 0
			for sy := range ss {
				for sx := range ss {
					dx := float64(x) + (float64(sx)+0.5)/ss - center
					dy := float64(y) + (float64(sy)+0.5)/ss - center
					if math.Hypot(dx, dy) <= r {
						hits++
					}
				}
			}
			if hits > 0 {
				img.SetNRGBA(x, y, color.NRGBA{c.R, c.G, c.B, uint8(int(c.A) * hits / (ss * ss))})
			}
		}
	}
	return img
}

// ICO encodes the circle as a .ico with 16×16 and 32×32 32-bit BMP images.
func ICO(c color.NRGBA) []byte {
	sizes := []int{16, 32}
	var images [][]byte
	for _, s := range sizes {
		images = append(images, dib(Circle(c, s)))
	}
	var buf bytes.Buffer
	le := binary.LittleEndian
	_ = binary.Write(&buf, le, [3]uint16{0, 1, uint16(len(sizes))}) // ICONDIR
	offset := 6 + 16*len(sizes)
	for i, s := range sizes {
		_ = binary.Write(&buf, le, struct {
			W, H, Colors, Reserved uint8
			Planes, BitCount       uint16
			Size, Offset           uint32
		}{uint8(s), uint8(s), 0, 0, 1, 32, uint32(len(images[i])), uint32(offset)})
		offset += len(images[i])
	}
	for _, img := range images {
		buf.Write(img)
	}
	return buf.Bytes()
}

// dib is the icon image format: a BITMAPINFOHEADER with doubled height,
// bottom-up BGRA rows, then a 1-bpp AND mask (all zero: alpha decides).
func dib(img *image.NRGBA) []byte {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	maskStride := (w + 31) / 32 * 4
	var buf bytes.Buffer
	le := binary.LittleEndian
	_ = binary.Write(&buf, le, struct {
		Size                   uint32
		Width, Height          int32
		Planes, BitCount       uint16
		Compression, SizeImage uint32
		XPPM, YPPM             int32
		ClrUsed, ClrImportant  uint32
	}{40, int32(w), int32(2 * h), 1, 32, 0, uint32(w*h*4 + maskStride*h), 0, 0, 0, 0})
	for y := h - 1; y >= 0; y-- {
		for x := range w {
			p := img.NRGBAAt(x, y)
			buf.Write([]byte{p.B, p.G, p.R, p.A})
		}
	}
	buf.Write(make([]byte, maskStride*h))
	return buf.Bytes()
}

// PNG is what the Linux tray (StatusNotifierItem) can decode.
func PNG(c color.NRGBA, size int) []byte {
	var buf bytes.Buffer
	_ = png.Encode(&buf, Circle(c, size))
	return buf.Bytes()
}

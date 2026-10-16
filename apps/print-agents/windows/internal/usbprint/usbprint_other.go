//go:build !windows && !linux

package usbprint

import (
	"context"
	"errors"
	"time"
)

var errUnsupported = errors.New("usbprint: not supported on this OS")

func List() ([]Device, error) { return nil, errUnsupported }

func Write(context.Context, Device, time.Duration, []byte) error { return errUnsupported }

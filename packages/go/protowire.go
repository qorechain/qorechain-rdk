package rdk

import "encoding/binary"

// Minimal protobuf wire encoder. Fields are written in ascending field-number
// order by the message encoders, matching the canonical cosmjs/gogoproto output
// so the resulting bytes are byte-for-byte identical to the TypeScript reference.

const (
	wireVarint = 0
	wireBytes  = 2
)

type protoWriter struct {
	buf []byte
}

func (w *protoWriter) bytes() []byte { return w.buf }

func (w *protoWriter) writeVarint(v uint64) {
	var tmp [binary.MaxVarintLen64]byte
	n := binary.PutUvarint(tmp[:], v)
	w.buf = append(w.buf, tmp[:n]...)
}

func (w *protoWriter) tag(field, wireType int) {
	w.writeVarint(uint64(field)<<3 | uint64(wireType))
}

// writeString writes a non-empty string field (length-delimited).
func (w *protoWriter) writeString(field int, s string) {
	if s == "" {
		return
	}
	w.tag(field, wireBytes)
	w.writeVarint(uint64(len(s)))
	w.buf = append(w.buf, s...)
}

// writeRawString writes a string field unconditionally (used inside Any/SignDoc).
func (w *protoWriter) writeRawString(field int, s string) {
	w.tag(field, wireBytes)
	w.writeVarint(uint64(len(s)))
	w.buf = append(w.buf, s...)
}

// writeBytes writes a non-empty bytes field (length-delimited).
func (w *protoWriter) writeBytes(field int, b []byte) {
	if len(b) == 0 {
		return
	}
	w.tag(field, wireBytes)
	w.writeVarint(uint64(len(b)))
	w.buf = append(w.buf, b...)
}

// writeRawBytes writes a bytes field unconditionally.
func (w *protoWriter) writeRawBytes(field int, b []byte) {
	w.tag(field, wireBytes)
	w.writeVarint(uint64(len(b)))
	w.buf = append(w.buf, b...)
}

// writeRepeatedBytes writes a repeated bytes field, one entry per element.
func (w *protoWriter) writeRepeatedBytes(field int, items [][]byte) {
	for _, item := range items {
		w.tag(field, wireBytes)
		w.writeVarint(uint64(len(item)))
		w.buf = append(w.buf, item...)
	}
}

// writeUint64 writes a non-zero uint64 varint field.
func (w *protoWriter) writeUint64(field int, v uint64) {
	if v == 0 {
		return
	}
	w.tag(field, wireVarint)
	w.writeVarint(v)
}

// writeRawUint64 writes a uint64 varint field unconditionally.
func (w *protoWriter) writeRawUint64(field int, v uint64) {
	w.tag(field, wireVarint)
	w.writeVarint(v)
}

// writeInt64 writes a non-zero int64 varint field (two's-complement varint, as
// gogoproto encodes int64).
func (w *protoWriter) writeInt64(field int, v int64) {
	if v == 0 {
		return
	}
	w.tag(field, wireVarint)
	w.writeVarint(uint64(v))
}

// writeBool writes a true bool field (false is the default and omitted).
func (w *protoWriter) writeBool(field int, v bool) {
	if !v {
		return
	}
	w.tag(field, wireVarint)
	w.writeVarint(1)
}

// writeEnum writes an enum varint field unconditionally.
func (w *protoWriter) writeEnum(field int, v uint64) {
	w.tag(field, wireVarint)
	w.writeVarint(v)
}

// writeMessage writes a non-empty embedded message field (length-delimited).
func (w *protoWriter) writeMessage(field int, b []byte) {
	w.tag(field, wireBytes)
	w.writeVarint(uint64(len(b)))
	w.buf = append(w.buf, b...)
}

package httpapi

import (
	"io"
	"mime/multipart"
	"net/http"
	"os"
)

// One file may be 10 MB; the transport allows the multipart framing on top.
// The worker rechecks the bytes themselves, so a lying size still refuses.
const maxUploadBytes = 12 << 20
const maxAttachmentBytes = 10 << 20

// attachments stages one file: the bytes land in the workspace's hidden
// folder, answered with the id messages carry. One file per call, so a big
// file fails alone and the transport limit is the per-file cap with margin.
func (s *Server) attachments(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "a multipart file field carries the bytes", http.StatusBadRequest)
		return
	}
	defer file.Close()
	staged, err := os.CreateTemp("", "acornfall-upload-*")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	stagedPath := staged.Name()
	defer os.Remove(stagedPath)
	written, err := io.Copy(staged, io.LimitReader(file, maxUploadBytes+1))
	if closeErr := staged.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if written == 0 {
		http.Error(w, "empty files carry nothing", http.StatusBadRequest)
		return
	}
	if written > maxAttachmentBytes {
		http.Error(w, "one file carries 10 MB at most", http.StatusRequestEntityTooLarge)
		return
	}
	attached, err := ctl.UploadAttachment(r.Context(), stagedPath, header.Filename, mimeOf(stagedPath, header), written)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusCreated, attached)
}

// mimeOf trusts the client's type unless it says nothing: a form upload
// names octet-stream for everything, and the shape decision needs better.
func mimeOf(stagedPath string, header *multipart.FileHeader) string {
	if claimed := header.Header.Get("Content-Type"); claimed != "" && claimed != "application/octet-stream" {
		return claimed
	}
	handle, err := os.Open(stagedPath)
	if err != nil {
		return "application/octet-stream"
	}
	defer handle.Close()
	var head [512]byte
	n, _ := handle.Read(head[:])
	if n == 0 {
		return "application/octet-stream"
	}
	return http.DetectContentType(head[:n])
}

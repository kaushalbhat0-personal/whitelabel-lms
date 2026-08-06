'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { UploadRecordingModal } from './upload-recording-modal';

interface ManualUploadButtonProps {
  onUploadComplete?: () => void;
}

export function ManualUploadButton({ onUploadComplete }: ManualUploadButtonProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        <Upload className="h-4 w-4" />
        Upload Video
      </button>

      <UploadRecordingModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onComplete={() => {
          setShowModal(false);
          onUploadComplete?.();
        }}
      />
    </>
  );
}

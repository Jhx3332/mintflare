"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import { Upload } from "lucide-react";

import { cn } from "@/lib/utils";

interface ImageUploadProps {
  onFileSelect: (file: File) => void;
  className?: string;
  file?: File | null;
  name?: string;
}

// Восстановлено из webpack-модуля 18612 (функция U).
export function ImageUpload({ onFileSelect, className, file }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(
    file ? URL.createObjectURL(file) : null,
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) {
        setPreview(URL.createObjectURL(accepted[0]));
        onFileSelect(accepted[0]);
      }
    },
    [onFileSelect],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/png": [".png"],
      "image/jpg": [".jpg"],
      "image/jpeg": [".jpeg"],
    },
    maxSize: 5242880,
    multiple: false,
  });

  return (
    <div className={cn("w-full max-w-4xl mx-auto", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "bg-[var(--surface-2)] relative h-auto rounded-2xl border-2 border-dashed p-6 h-full transition-all",
          "text-center cursor-pointer",
          "hover:border-gray-400 hover:bg-gray-100/8",
          isDragActive ? "border-gray-400 bg-[var(--surface)]/50" : "border-[var(--border)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
        )}
      >
        <input name="tokenImage" {...getInputProps()} required />
        <div className="flex flex-col items-center">
          <div className="space-y-2 flex flex-col items-center">
            {preview || file ? (
              <Image
                width={80}
                height={120}
                className="max-w-24"
                src={preview || (file ? URL.createObjectURL(file) : "")}
                alt="Selected"
              />
            ) : (
              <>
                <div className="flex items-center justify-center w-20 h-20 rounded-full bg-[var(--surface)] p-4">
                  <Upload className="h-8 w-8 text-gray-400" />
                </div>
                <p className="text-gray-300">
                  <span className="font-semibold text-white">Click to upload</span> or drag and drop
                </p>
                <p className="text-sm text-gray-400">PNG or JPG. Max 5MB.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

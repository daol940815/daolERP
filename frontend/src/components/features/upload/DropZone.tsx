'use client'

import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, File, X } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  file: File | null
  onFileSelect: (file: File | null) => void
}

export default function DropZone({ file, onFileSelect }: Props) {
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) onFileSelect(accepted[0])
  }, [onFileSelect])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
    multiple: false,
  })

  if (file) {
    return (
      <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4 flex items-center gap-3">
        <File className="w-8 h-8 text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-200 font-medium truncate">{file.name}</div>
          <div className="text-xs text-slate-500">
            {(file.size / 1024).toFixed(1)} KB
          </div>
        </div>
        <button
          onClick={() => onFileSelect(null)}
          className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      {...getRootProps()}
      className={clsx(
        'border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors',
        isDragActive
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className={clsx('w-12 h-12', isDragActive ? 'text-blue-400' : 'text-slate-500')} />
      <div className="text-center">
        <div className="text-sm text-slate-300 font-medium">
          {isDragActive ? '파일을 여기에 놓으세요' : '파일을 드래그하거나 클릭하여 선택'}
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Excel (.xlsx, .xls), CSV 파일 지원
        </div>
      </div>
    </div>
  )
}

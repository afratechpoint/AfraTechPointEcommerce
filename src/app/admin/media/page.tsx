"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Upload,
  Trash2,
  Copy,
  Check,
  ImageIcon,
  Search,
  X,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import PremiumSpinner from "@/components/PremiumSpinner";
import { authenticatedFetch } from "@/lib/api-helper";
import { copyText } from "@/lib/clipboard";
import { prepareImageFile } from "@/lib/image-prep";

interface MediaFile {
  name: string;
  url: string;
  size: number;
  uploadedAt: string;
  deleteUrl?: string;
  imgbbId?: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminMediaPage() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [filtered, setFiltered] = useState<MediaFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    usedBytes: number;
    totalBytes: number;
    availableBytes: number;
    percentUsed: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async (isSync = false) => {
    setIsLoading(true);
    try {
      const url = isSync ? "/api/upload?sync=true" : "/api/upload";
      if (isSync) toast.info("Syncing media library…");

      const res = await authenticatedFetch(url);
      const data = await res.json();
      if (Array.isArray(data)) {
        setFiles(data);
        setFiltered(data);
      }

      if (isSync) toast.success("Media library synced");
    } catch {
      toast.error("Failed to load media files.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await authenticatedFetch("/api/admin/storage-usage");
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchFiles();
    fetchUsage();
  }, [fetchFiles, fetchUsage]);

  useEffect(() => {
    const q = search.toLowerCase().trim();
    setFiltered(q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files);
  }, [search, files]);

  const uploadFiles = async (rawFiles: FileList | File[]) => {
    const fileArr = Array.from(rawFiles);
    if (fileArr.length === 0) return;

    setIsUploading(true);
    try {
      const prepared: File[] = [];
      for (const file of fileArr) {
        try {
          prepared.push(await prepareImageFile(file));
        } catch (e: any) {
          toast.error(e?.message || `Could not prepare "${file.name}".`);
        }
      }
      if (prepared.length === 0) return;

      const formData = new FormData();
      prepared.forEach((f) => formData.append("files", f));

      const res = await authenticatedFetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (data.files?.length) {
        toast.success(`${data.files.length} file(s) uploaded`);
        fetchFiles();
        fetchUsage();
      }
      if (data.failed?.length) {
        toast.error(`${data.failed.length} file(s) failed — ${data.failed[0].name}`);
      }
      if (!data.files?.length && !data.failed?.length) {
        toast.error(data.error || "Upload failed.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const handleDelete = async (file: MediaFile) => {
    setDeleting(file.name);
    try {
      const res = await authenticatedFetch("/api/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (res.ok) {
        toast.success("File deleted");
        if (selected?.name === file.name) setSelected(null);
        fetchFiles();
        fetchUsage();
      } else {
        toast.error("Failed to delete file.");
      }
    } catch {
      toast.error("Failed to delete file.");
    } finally {
      setDeleting(null);
    }
  };

  const copyUrl = async (url: string) => {
    const fullUrl = /^https?:\/\//i.test(url) ? url : `${window.location.origin}${url}`;
    const ok = await copyText(fullUrl);
    if (!ok) {
      toast.error("Could not copy URL");
      return;
    }
    setCopiedUrl(url);
    toast.success("URL copied");
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      {/* ── Compact Stats + Upload Bar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl border border-gray-200/80 p-4">
            <p className="text-[11px] font-medium text-gray-400">Total Files</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{files.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/80 p-4">
            <p className="text-[11px] font-medium text-gray-400">Used Space</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">
              {formatBytes(totalSize)}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/80 p-4">
            <p className="text-[11px] font-medium text-gray-400">Available</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">
              {usage ? formatBytes(usage.availableBytes) : "20 GB"}
            </p>
          </div>
        </div>

        {/* Compact Drag & Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "lg:col-span-5 rounded-2xl border border-dashed p-4 flex items-center justify-between gap-3 cursor-pointer transition-colors",
            isDragging
              ? "border-black bg-gray-100"
              : "border-gray-300 bg-white hover:border-black"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-800 flex items-center justify-center shrink-0">
              {isUploading ? <PremiumSpinner size="sm" /> : <Upload size={17} />}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                {isUploading
                  ? "Uploading images…"
                  : isDragging
                  ? "Drop images now"
                  : "Upload images"}
              </p>
              <p className="text-[11px] text-gray-400 truncate">
                Drag & drop or click · PNG, JPG, WebP
              </p>
            </div>
          </div>

          <span className="h-8 px-3 rounded-lg bg-black text-white text-xs font-semibold inline-flex items-center shrink-0">
            Browse
          </span>
        </div>
      </div>

      {/* ── Search + Sync Toolbar ── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-3 flex items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media files…"
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-gray-50 border border-gray-200/80 focus:bg-white focus:border-black text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => fetchFiles(true)}
          disabled={isLoading}
          title="Sync with ImageKit"
          className="h-10 px-3.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:border-black hover:text-black inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={14} className={cn(isLoading && "animate-spin")} />
          <span className="hidden sm:inline">Sync</span>
        </button>
      </div>

      {/* ── Gallery Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/80 py-20 text-center">
          <ImageIcon size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-semibold text-gray-800">
            {search ? "No matching files" : "No files uploaded yet"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {search ? "Try another search term." : "Upload images above to get started."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
          {filtered.map((file) => (
            <div
              key={file.url}
              onClick={() => setSelected(selected?.name === file.name ? null : file)}
              className={cn(
                "relative aspect-square rounded-2xl overflow-hidden cursor-pointer border bg-white transition-all group",
                selected?.name === file.name
                  ? "border-black ring-2 ring-black/10"
                  : "border-gray-200/80 hover:border-gray-300"
              )}
            >
              <img
                src={file.url}
                alt={file.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />

              {/* Hover Actions */}
              <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyUrl(file.url);
                  }}
                  className="w-8 h-8 rounded-lg bg-white text-gray-900 flex items-center justify-center hover:bg-gray-100 cursor-pointer"
                  title="Copy URL"
                >
                  {copiedUrl === file.url ? (
                    <Check size={14} className="text-emerald-600" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(file);
                  }}
                  disabled={deleting === file.name}
                  className="w-8 h-8 rounded-lg bg-white text-red-600 flex items-center justify-center hover:bg-red-50 cursor-pointer"
                  title="Delete"
                >
                  {deleting === file.name ? <PremiumSpinner size="sm" /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Clean File Detail Modal ── */}
      <AnimatePresence>
        {selected && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 bg-black/45 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900">File Details</h4>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="h-40 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
                <img
                  src={selected.url}
                  alt={selected.name}
                  className="max-w-full max-h-full object-contain p-2"
                />
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400 shrink-0">File</span>
                  <span className="font-semibold text-gray-900 truncate">{selected.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400">Size</span>
                  <span className="font-semibold text-gray-900">{formatBytes(selected.size)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => copyUrl(selected.url)}
                  className="flex-1 h-9 rounded-xl bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  <Copy size={13} /> Copy URL
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(selected)}
                  disabled={deleting === selected.name}
                  className="w-9 h-9 rounded-xl border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  title="Delete"
                >
                  {deleting === selected.name ? <PremiumSpinner size="sm" /> : <Trash2 size={14} />}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

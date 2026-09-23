'use client';

import Link from 'next/link';
import { PlayCircle, Clock, ChevronDown, ChevronRight, FileText, HelpCircle, Calendar, Video, Lock, CheckCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { StudentVideo, StudentCurriculumCategory, StudentCurriculumItem } from '@/lib/api/videos';
import { getBatchProgress, type BatchProgress } from '@/lib/api/recordings';

interface Props {
  batchName: string;
  batchId: string;
  categories: StudentCurriculumCategory[];
  recordings: StudentVideo[];
}

const contentTypeIcon = (type: string) => {
  switch (type) {
    case 'test': return HelpCircle;
    case 'session': return Calendar;
    case 'pdf': return FileText;
    default: return Video;
  }
};

const contentTypeBadge = (type: string) => {
  const colors: Record<string, string> = {
    recording: 'bg-blue-100 text-blue-700',
    test: 'bg-purple-100 text-purple-700',
    session: 'bg-orange-100 text-orange-700',
    pdf: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${colors[type] ?? 'bg-gray-100 text-gray-500'}`}>
      {type}
    </span>
  );
};

function recordingProgress(contentId: string | undefined, recordings: StudentVideo[]) {
  const match = recordings.find((r) => r.id === contentId);
  if (!match) return null;
  return match.progress;
}

function itemLink(item: StudentCurriculumItem): string {
  if (item.content_type === 'recording') return `/student/videos/${item.content_id}`;
  if (item.content_type === 'test') return `/student/tests/${item.content_id}`;
  if (item.content_type === 'session') return `/student/live-sessions/${item.content_id}`;
  return '#';
}

export function CurriculumView({ batchName, batchId, categories, recordings }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [prerequisiteMap, setPrerequisiteMap] = useState<Set<string>>(new Set());
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    getBatchProgress(batchId)
      .then((p) => {
        setProgress(p);
        const prereqLocked = new Set<string>();
        const completed = new Set<string>();

        for (const prereq of p.prerequisites) {
          const prereqItem = p.categories
            .flatMap((c) => c.items)
            .find((i) => i.curriculumId === prereq.prerequisite_id);
          const currItem = p.categories
            .flatMap((c) => c.items)
            .find((i) => i.curriculumId === prereq.curriculum_id);

          if (currItem && (!prereqItem || !prereqItem.completed)) {
            prereqLocked.add(prereq.curriculum_id);
          }
        }

        for (const cat of p.categories) {
          for (const item of cat.items) {
            if (item.completed) completed.add(item.curriculumId);
          }
        }

        setPrerequisiteMap(prereqLocked);
        setCompletedItems(completed);
      })
      .catch(() => {});
  }, [batchId]);

  const toggle = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div>
      <h2 className="mb-4 text-base font-semibold text-gray-900">{batchName}</h2>
      {progress && (
        <div className="mb-4 flex gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <CheckCircle className="h-3.5 w-3.5 text-status-success" />
            {progress.categories.filter((c) => c.isCompleted).length}/{progress.categories.length} modules complete
          </span>
        </div>
      )}
      <div className="space-y-3">
        {categories.map((cat) => {
          const catProgress = progress?.categories.find((c) => c.category === cat.category);
          const barPercent = catProgress ? Math.round((catProgress.completedItems / catProgress.totalItems) * 100) : 0;

          return (
            <div key={cat.category} className="rounded-xl border border-surface-border bg-surface-card overflow-hidden">
              <button
                onClick={() => toggle(cat.category)}
                className="flex w-full items-center gap-2 bg-surface-muted px-4 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-100"
              >
                {collapsed.has(cat.category) ? (
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                )}
                <div className="flex-1">
                  <span>{cat.category}</span>
                  {catProgress && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-status-success transition-all"
                          style={{ width: `${barPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted">
                        {catProgress.completedItems}/{catProgress.totalItems}
                      </span>
                    </div>
                  )}
                </div>
                {catProgress?.isCompleted && (
                  <CheckCircle className="h-4 w-4 text-status-success" />
                )}
              </button>

              {!collapsed.has(cat.category) && (
                <div className="divide-y divide-surface-border">
                  {cat.items.map((item) => {
                    const Icon = contentTypeIcon(item.content_type);
                    const progress = recordingProgress(item.content_id, recordings);
                    const isCompleted = completedItems.has(item.id);
                    const isLocked = prerequisiteMap.has(item.id);
                    const isExternal = item.content_type === 'pdf';
                    const linkHref = itemLink(item);

                    const inner = (
                      <div className={`flex items-center gap-3 px-4 py-3 transition-colors ${isLocked ? 'opacity-50' : 'hover:bg-surface-muted'}`}>
                        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${isCompleted ? 'bg-status-success/10' : 'bg-brand-navy/10'}`}>
                          {isCompleted ? (
                            <CheckCircle className="h-5 w-5 text-status-success" />
                          ) : isLocked ? (
                            <Lock className="h-5 w-5 text-text-muted" />
                          ) : (
                            <Icon className="h-5 w-5 text-brand-navy" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex items-center gap-2">
                            {contentTypeBadge(item.content_type)}
                            <p className="text-sm font-medium text-text-primary truncate">
                              {item.content?.title ?? item.content_type}
                            </p>
                          </div>
                          {item.content?.description?.trim() ? (
                            <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-text-secondary">
                              {item.content.description.trim()}
                            </p>
                          ) : null}
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                            {item.module_name && <span>{item.module_name}</span>}
                            {progress && progress.watched_seconds > 0 && (
                              <>
                                <span>·</span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {Math.floor(progress.watched_seconds / 60)}m
                                </span>
                              </>
                            )}
                            {isLocked && (
                              <span className="text-status-ended">Locked</span>
                            )}
                          </div>
                          {isCompleted && (
                            <span className="mt-0.5 inline-block text-[10px] font-medium text-status-success">
                              Completed
                            </span>
                          )}
                        </div>
                        {!isLocked && <Icon className="h-5 w-5 shrink-0 text-text-muted" />}
                      </div>
                    );

                    if (isLocked) return <div key={item.id}>{inner}</div>;
                    if (isExternal) {
                      return (
                        <a key={item.id} href={linkHref} target="_blank" rel="noopener noreferrer">
                          {inner}
                        </a>
                      );
                    }
                    return (
                      <Link key={item.id} href={linkHref}>
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';
import { type StudentCourse } from '@/lib/api/courses';

interface Props {
  courses: StudentCourse[];
}

export function CoursesListClient({ courses }: Props) {
  if (courses.length === 0) {
    return (
      <div className="rounded-card border-2 border-dashed border-surface-border p-8 text-center">
        <BookOpen className="mx-auto h-10 w-10 text-text-muted" />
        <p className="mt-3 text-sm font-medium text-text-primary">
          You are not enrolled in any courses yet.
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          Courses will appear here once you are added to a batch.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
      {courses.map((course) => (
        <Link
          key={course.id}
          href={`/student/courses/${course.id}`}
          className="block rounded-card border border-surface-border bg-surface-card p-4 transition-shadow hover:shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
              <BookOpen className="h-5 w-5 text-brand-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text-primary truncate">
                {course.name}
              </h3>
              {course.enrolledBatches && course.enrolledBatches.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {course.enrolledBatches.map((b) => (
                    <span
                      key={b.id}
                      className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-text-secondary"
                    >
                      {b.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
                <span>{course.enrolledBatches?.length ?? 0} batch{(course.enrolledBatches?.length ?? 0) !== 1 ? 'es' : ''}</span>
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
          </div>
        </Link>
      ))}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, FileText, Video, HelpCircle, Calendar, Pencil, Check, X } from 'lucide-react';
import {
  type CurriculumCategory,
  type CurriculumItem,
  getBatchCurriculum,
  addCurriculumItem,
  removeCurriculumItem,
  reorderCurriculum,
  updateCurriculumItem,
  getRecordings,
  type Recording,
} from '@/lib/api/recordings';
import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

interface CurriculumTabProps {
  batchId: string;
}

const CONTENT_TYPES = [
  { value: 'recording', label: 'Recording', icon: Video },
  { value: 'test', label: 'Test', icon: HelpCircle },
  { value: 'session', label: 'Session', icon: Calendar },
  { value: 'pdf', label: 'PDF', icon: FileText },
];

const contentTypeIcon = (type: string) => {
  const ct = CONTENT_TYPES.find((t) => t.value === type);
  if (!ct) return Video;
  return ct.icon;
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

export function CurriculumTab({ batchId }: CurriculumTabProps) {
  const [categories, setCategories] = useState<CurriculumCategory[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContentType, setNewContentType] = useState('recording');
  const [newContentId, setNewContentId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('General');
  const [newPdfUrl, setNewPdfUrl] = useState('');
  const [newPdfTitle, setNewPdfTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemCategory, setEditingItemCategory] = useState('');
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  const dragItem = useRef<{ category: string; index: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [cats, recs, testData, sessData] = await Promise.all([
        getBatchCurriculum(batchId),
        getRecordings(),
        fetchApi<any[]>(API_ROUTES.ADMIN_TESTS).catch(() => []),
        fetchApi<any[]>(`${API_ROUTES.BATCHES}/${batchId}/sessions`).catch(() => []),
      ]);
      setCategories(cats ?? []);
      setRecordings(Array.isArray(recs) ? recs : []);
      setTests(Array.isArray(testData) ? testData : []);
      setSessions(Array.isArray(sessData) ? sessData : []);
    } catch {
      setError('Failed to load curriculum');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newCategoryName) return;
    if (newContentType !== 'pdf' && !newContentId) return;

    try {
      const payload: any = {
        contentType: newContentType,
        categoryName: newCategoryName,
      };
      if (newContentType === 'pdf') {
        payload.pdfUrl = newPdfUrl;
        payload.pdfTitle = newPdfTitle || undefined;
      } else {
        payload.contentId = newContentId;
      }
      await addCurriculumItem(batchId, payload);
      resetAddForm();
      load();
    } catch {
      setError('Failed to add item');
    }
  };

  const resetAddForm = () => {
    setNewContentId('');
    setNewContentType('recording');
    setNewCategoryName('General');
    setNewPdfUrl('');
    setNewPdfTitle('');
    setShowAddForm(false);
  };

  const handleRemove = async (id: string) => {
    try {
      await removeCurriculumItem(id);
      load();
    } catch {
      setError('Failed to remove item');
    }
  };

  const toggleCollapse = (category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const handleDragStart = (category: string, index: number) => {
    dragItem.current = { category, index };
  };

  const handleDrop = async (targetCategory: string, targetIndex: number) => {
    const source = dragItem.current;
    dragItem.current = null;

    if (!source || (source.category === targetCategory && source.index === targetIndex)) return;

    const cat = (categories ?? []).find((c) => c.category === targetCategory);
    if (!cat) return;

    const items = [...cat.items];
    const [moved] = items.splice(source.index, 1);
    items.splice(targetIndex, 0, moved);

    setCategories((prev) =>
      prev.map((c) => (c.category === targetCategory ? { ...c, items } : c)),
    );

    try {
      await reorderCurriculum(batchId, items.map((item, i) => ({ id: item.id, sortOrder: i })));
      setError('');
      setLiveMessage(`Reordered ${targetCategory}: item moved to position ${targetIndex + 1}`);
    } catch {
      setError('Reorder failed');
      setLiveMessage('Reorder failed');
      load();
    }
  };

  const handleRenameCategory = async (oldName: string) => {
    if (!renameValue.trim() || renameValue === oldName) {
      setEditingCategory(null);
      return;
    }
    const cat = (categories ?? []).find((c) => c.category === oldName);
    if (!cat) return;

    try {
      await Promise.all(
        cat.items.map((item) =>
          updateCurriculumItem(item.id, { categoryName: renameValue.trim() }),
        ),
      );
      setEditingCategory(null);
      load();
    } catch {
      setError('Failed to rename category');
    }
  };

  const handleStartEditItem = (item: CurriculumItem) => {
    setEditingItemId(item.id);
    setEditingItemCategory(item.category_name ?? 'General');
  };

  const handleCancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemCategory('');
  };

  const handleSaveItemCategory = async (item: CurriculumItem) => {
    const trimmed = editingItemCategory.trim() || 'General';
    if (trimmed === item.category_name) {
      handleCancelEditItem();
      return;
    }
    setSavingItemId(item.id);
    setError('');
    try {
      await updateCurriculumItem(item.id, { categoryName: trimmed });
      setEditingItemId(null);
      setEditingItemCategory('');
      await load();
    } catch {
      setError('Failed to update category');
    } finally {
      setSavingItemId(null);
    }
  };

  const unusedRecordings = (recordings ?? []).filter(
    (r) => !(categories ?? []).some((c) => (c.items ?? []).some((i) => i.content_id === r.id && i.content_type === 'recording')),
  );

  const unusedTests = (tests ?? []).filter(
    (t: any) => !(categories ?? []).some((c) => (c.items ?? []).some((i) => i.content_id === t.id && i.content_type === 'test')),
  );

  const unusedSessions = (sessions ?? []).filter(
    (s: any) => !(categories ?? []).some((c) => (c.items ?? []).some((i) => i.content_id === s.id && i.content_type === 'session')),
  );

  if (loading) return <p className="text-gray-500">Loading curriculum...</p>;
  if (error && categories.length === 0) return <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>;

  const itemTitle = (item: CurriculumItem) => {
    if (item.content?.title) return item.content.title;
    if (item.content_type === 'pdf') return item.pdf_title || item.title_override || 'PDF Document';
    return item.recordings?.title ?? item.title_override ?? 'Unknown';
  };

  return (
    <div className="space-y-6">
      <div aria-live="polite" aria-atomic="true" className="sr-only">{liveMessage}</div>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Curriculum</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {showAddForm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content Type</label>
            <div className="flex gap-2">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  onClick={() => { setNewContentType(ct.value); setNewContentId(''); }}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    newContentType === ct.value
                      ? 'border-brand-600 bg-brand-50 text-brand-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <ct.icon className="h-3.5 w-3.5" />
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          {newContentType === 'pdf' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PDF URL</label>
                <input
                  type="text"
                  value={newPdfUrl}
                  onChange={(e) => setNewPdfUrl(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PDF Title</label>
                <input
                  type="text"
                  value={newPdfTitle}
                  onChange={(e) => setNewPdfTitle(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="e.g. Chapter 1 Notes"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {newContentType === 'recording' ? 'Recording' : newContentType === 'test' ? 'Test' : 'Session'}
              </label>
              <select
                value={newContentId}
                onChange={(e) => setNewContentId(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {(newContentType === 'recording' ? unusedRecordings : newContentType === 'test' ? unusedTests : unusedSessions).map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.title ?? item.topic ?? item.name ?? item.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="e.g. Week 1, Module 2"
              list="existing-categories"
            />
            <datalist id="existing-categories">
              {categories.map((c) => (
                <option key={c.category} value={c.category} />
              ))}
            </datalist>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={newContentType !== 'pdf' && !newContentId}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={resetAddForm}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {categories.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No curriculum items yet. Add content to get started.</p>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat.category} className="rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                <button
                  onClick={() => toggleCollapse(cat.category)}
                  className="flex items-center gap-2 text-left text-sm font-semibold text-gray-900 flex-1"
                >
                  {collapsed.has(cat.category) ? (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                  {editingCategory === cat.category ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameCategory(cat.category)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameCategory(cat.category);
                        if (e.key === 'Escape') setEditingCategory(null);
                      }}
                      className="rounded border border-gray-300 px-2 py-0.5 text-sm"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="cursor-pointer hover:text-brand-600"
                      onDoubleClick={() => {
                        setEditingCategory(cat.category);
                        setRenameValue(cat.category);
                      }}
                    >
                      {cat.category}
                    </span>
                  )}
                </button>
                <span className="text-xs font-normal text-gray-500">{(cat.items ?? []).length} items</span>
              </div>

              {!collapsed.has(cat.category) && (
                <ul
                  className="divide-y divide-gray-100 min-h-[2rem]"
                  onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('bg-blue-50'); }}
                  onDragLeave={(e) => { (e.currentTarget as HTMLElement).classList.remove('bg-blue-50'); }}
                  onDrop={(e) => {
                    (e.currentTarget as HTMLElement).classList.remove('bg-blue-50');
                    handleDrop(cat.category, cat.items.length);
                  }}
                >
                  {(cat.items ?? []).map((item, index) => {
                    const Icon = contentTypeIcon(item.content_type);
                    return (
                      <li
                        key={item.id}
                        draggable
                        onDragStart={() => handleDragStart(cat.category, index)}
                        onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('opacity-50'); }}
                        onDragLeave={(e) => { (e.currentTarget as HTMLElement).classList.remove('opacity-50'); }}
                        onDrop={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as HTMLElement).classList.remove('opacity-50');
                          handleDrop(cat.category, index);
                        }}
                        onDragEnd={() => {
                          document.querySelectorAll('.opacity-50').forEach((el) => el.classList.remove('opacity-50'));
                          document.querySelectorAll('.bg-blue-50').forEach((el) => el.classList.remove('bg-blue-50'));
                        }}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
                        <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                        {contentTypeBadge(item.content_type)}
                        {editingItemId === item.id ? (
                          <>
                            <span className="flex-1 truncate text-text-muted">{itemTitle(item)}</span>
                            <label htmlFor={`edit-category-${item.id}`} className="sr-only">Category for {itemTitle(item)}</label>
                            <input
                              id={`edit-category-${item.id}`}
                              type="text"
                              value={editingItemCategory}
                              onChange={(e) => setEditingItemCategory(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveItemCategory(item);
                                if (e.key === 'Escape') handleCancelEditItem();
                              }}
                              className="w-36 rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                              placeholder="Category"
                              list="existing-categories"
                              autoFocus
                              aria-label={`Category for ${itemTitle(item)}`}
                              disabled={savingItemId === item.id}
                            />
                            <button
                              onClick={() => handleSaveItemCategory(item)}
                              disabled={savingItemId === item.id}
                              className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
                              title="Save category"
                              aria-label={`Save category for ${itemTitle(item)}`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={handleCancelEditItem}
                              disabled={savingItemId === item.id}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-50"
                              title="Cancel"
                              aria-label="Cancel editing category"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 truncate">{itemTitle(item)}</span>
                            {item.module_name && (
                              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                                {item.module_name}
                              </span>
                            )}
                            <span className={`hidden sm:inline rounded-full px-2 py-0.5 text-xs font-medium ${item.is_published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {item.is_published ? 'Published' : 'Draft'}
                            </span>
                            <button
                              onClick={() => handleStartEditItem(item)}
                              className="rounded p-1 text-gray-400 hover:bg-brand-50 hover:text-brand-600"
                              title={`Edit category (current: ${item.category_name})`}
                              aria-label={`Edit category for ${itemTitle(item)}, current ${item.category_name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemove(item.id)}
                              className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-600"
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

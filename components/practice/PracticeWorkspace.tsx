import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPracticeLessonDraft,
  createPracticeProfile,
  deletePracticeBookmark,
  downloadPracticeJson,
  downloadPracticeMarkdown,
  getOrCreatePracticeProfile,
  getPracticeReviewQueue,
  importPracticeArchive,
  listPracticeBookmarks,
  listPracticeLessons,
  listPracticeProfiles,
  listPracticeAttempts,
  parsePracticeExport,
  PRACTICE_QUESTION_TYPES,
  PRACTICE_SUBJECTS,
  PRACTICE_SUBJECT_FIXTURES,
  recordPracticeAttempt,
  savePracticeBookmark,
  savePracticeLesson,
  setActivePracticeProfileId,
  validatePracticeLesson,
  type PracticeAttempt,
  type PracticeLesson,
  type PracticeLessonDraftInput,
  type PracticeProfile,
  type PracticeQuestion,
  type PracticeQuestionType,
  type PracticeReviewItem,
  type PracticeSource,
  type PracticeSubject,
} from '../../services/practiceWorkspaceService';

export interface PracticeWorkspaceProps {
  /** Optional controlled profile for an embedding shell. */
  profileId?: string;
  /** Called when the host wants to close the standalone workspace. */
  onClose?: () => void;
  onLessonSaved?: (lesson: PracticeLesson) => void;
  className?: string;
}

interface DraftFormState {
  gradeLevel: string;
  subject: PracticeSubject;
  topic: string;
  learningObjectives: string;
}

const DEFAULT_FORM: DraftFormState = {
  gradeLevel: '國小五年級',
  subject: 'english',
  topic: PRACTICE_SUBJECT_FIXTURES.english.defaultTopic,
  learningObjectives: '能辨識核心概念\n能用一句話說明自己的理解',
};

const subjectLabels: Record<PracticeSubject, string> = {
  english: '英文',
  math: '數學',
  science: '自然',
};

const questionTypeLabels: Record<PracticeQuestionType, string> = {
  choice: '選擇題',
  fill: '填空題',
  'free-response': '自由回答',
};

const formatTime = (value: number): string =>
  new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);

const questionValidationMessage = (question: PracticeQuestion): string | null => {
  const result = validatePracticeLesson({
    id: 'draft',
    schemaVersion: 1,
    version: 1,
    title: 'draft',
    gradeLevel: 'draft',
    subject: 'english',
    topic: 'draft',
    learningObjectives: ['draft'],
    lessonPlan: 'draft',
    questions: [question],
    sources: [],
    ownerProfileId: 'draft',
    generatedBy: 'teacher',
    createdAt: 0,
    updatedAt: 0,
  });
  const issue = result.errors.find(error => error.path.startsWith('questions.0'));
  return issue?.message ?? null;
};

const PracticeWorkspace: React.FC<PracticeWorkspaceProps> = ({
  profileId: controlledProfileId,
  onClose,
  onLessonSaved,
  className,
}) => {
  const [profiles, setProfiles] = useState<PracticeProfile[]>([]);
  const [profile, setProfile] = useState<PracticeProfile | null>(null);
  const [lessons, setLessons] = useState<PracticeLesson[]>([]);
  const [reviewItems, setReviewItems] = useState<PracticeReviewItem[]>([]);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PracticeLesson | null>(null);
  const [form, setForm] = useState<DraftFormState>(DEFAULT_FORM);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, PracticeAttempt>>({});
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [newProfileName, setNewProfileName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshForProfile = useCallback(async (nextProfile: PracticeProfile) => {
    const [nextLessons, nextReview, nextBookmarks] = await Promise.all([
      listPracticeLessons(nextProfile.id),
      getPracticeReviewQueue(nextProfile.id),
      listPracticeBookmarks(nextProfile.id),
    ]);
    setLessons(nextLessons);
    setReviewItems(nextReview);
    setBookmarks(
      new Set(nextBookmarks.map(bookmark => `${bookmark.lessonId}:${bookmark.questionId}`)),
    );
    setSelectedLessonId(current =>
      current && nextLessons.some(lesson => lesson.id === current)
        ? current
        : (nextLessons[0]?.id ?? null),
    );
    setActiveLessonId(current =>
      current && nextLessons.some(lesson => lesson.id === current) ? current : null,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const nextProfile = controlledProfileId
        ? ((await listPracticeProfiles()).find(item => item.id === controlledProfileId) ??
          (await createPracticeProfile('本機匿名使用者')))
        : await getOrCreatePracticeProfile();
      if (cancelled) {
        return;
      }
      setProfile(nextProfile);
      setActivePracticeProfileId(nextProfile.id);
      setProfiles(await listPracticeProfiles());
      await refreshForProfile(nextProfile);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [controlledProfileId, refreshForProfile]);

  const selectedLesson = useMemo(
    () => lessons.find(lesson => lesson.id === selectedLessonId) ?? null,
    [lessons, selectedLessonId],
  );
  const activeLesson = useMemo(
    () => lessons.find(lesson => lesson.id === activeLessonId) ?? null,
    [activeLessonId, lessons],
  );

  useEffect(() => {
    if (!activeLesson || !profile) {
      setAttempts({});
      return;
    }
    let cancelled = false;
    void listPracticeAttempts(profile.id, activeLesson.id).then(records => {
      if (cancelled) {
        return;
      }
      const latest: Record<string, PracticeAttempt> = {};
      for (const record of records) {
        if (!latest[record.questionId]) {
          latest[record.questionId] = record;
        }
      }
      setAttempts(latest);
    });
    return () => {
      cancelled = true;
    };
  }, [activeLesson, profile]);

  const handleGeneratePreview = () => {
    if (!profile) {
      return;
    }
    const input: PracticeLessonDraftInput = {
      ...form,
      profileId: profile.id,
    };
    const nextDraft = createPracticeLessonDraft(input);
    setDraft(nextDraft);
    setStatusMessage('題組預覽已產生；可先編輯內容、答案與來源，再保存。');
    setImportError('');
  };

  const updateDraft = (patch: Partial<PracticeLesson>) => {
    setDraft(current => (current ? { ...current, ...patch, updatedAt: Date.now() } : current));
  };

  const updateDraftQuestion = (questionId: string, patch: Partial<PracticeQuestion>) => {
    setDraft(current => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        updatedAt: Date.now(),
        questions: current.questions.map(question =>
          question.id === questionId ? { ...question, ...patch, schemaValid: undefined } : question,
        ),
      };
    });
  };

  const updateQuestionSource = (
    questionId: string,
    sourceId: string,
    patch: Partial<Omit<PracticeSource, 'id'>>,
  ) => {
    setDraft(current => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        updatedAt: Date.now(),
        questions: current.questions.map(question =>
          question.id === questionId
            ? {
                ...question,
                sources: question.sources.map(source =>
                  source.id === sourceId ? { ...source, ...patch } : source,
                ),
              }
            : question,
        ),
      };
    });
  };

  const addQuestionSource = (questionId: string) => {
    const source: PracticeSource = {
      id: `source-${Date.now()}`,
      title: '教師待確認來源',
      status: 'unverified',
      notes: '請教師補上可核對的教材、頁碼或網址。',
    };
    setDraft(current => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        updatedAt: Date.now(),
        questions: current.questions.map(question =>
          question.id === questionId
            ? { ...question, sources: [...question.sources, source] }
            : question,
        ),
      };
    });
  };

  const handleSaveDraft = async () => {
    if (!draft || !profile) {
      return;
    }
    const validation = validatePracticeLesson(draft);
    const questionErrors = validation.errors.filter(error => error.path.startsWith('questions.'));
    const structuralErrors = validation.errors.filter(
      error => !error.path.startsWith('questions.'),
    );
    if (structuralErrors.length) {
      setStatusMessage(`無法保存：${structuralErrors[0].message}`);
      return;
    }
    try {
      const saved = await savePracticeLesson({
        ...draft,
        ownerProfileId: profile.id,
        generatedBy: 'teacher',
      });
      setDraft(null);
      setStatusMessage(
        questionErrors.length
          ? '教案已保存；含 schema 無效題目，該題會保持未計分直到修正。'
          : '教案已保存，可在題組區開始練習。',
      );
      onLessonSaved?.(saved);
      await refreshForProfile(profile);
      setSelectedLessonId(saved.id);
    } catch (error) {
      setStatusMessage(`保存失敗：${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  };

  const handleProfileChange = async (nextProfileId: string) => {
    const nextProfile = profiles.find(item => item.id === nextProfileId);
    if (!nextProfile) {
      return;
    }
    setProfile(nextProfile);
    setActivePracticeProfileId(nextProfile.id);
    setDraft(null);
    setStatusMessage(`已切換到「${nextProfile.displayName}」；練習紀錄與書籤彼此隔離。`);
    await refreshForProfile(nextProfile);
  };

  const handleCreateProfile = async () => {
    const created = await createPracticeProfile(newProfileName || undefined);
    setNewProfileName('');
    setProfiles(await listPracticeProfiles());
    await handleProfileChange(created.id);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const parsed = parsePracticeExport(text);
    if (!parsed.ok || !parsed.data) {
      setImportError(parsed.errors.map(error => error.message).join('；'));
      return;
    }
    try {
      const result = await importPracticeArchive(text, {
        targetProfileId: profile?.id,
      });
      setImportError('');
      setStatusMessage(
        `匯入完成：新增 ${result.copiedIds.lessonIds.length} 份教案（以副本建立，不覆蓋原資料）。`,
      );
      if (profile) {
        await refreshForProfile(profile);
      }
    } catch (error) {
      setImportError(`匯入失敗：${error instanceof Error ? error.message : '格式錯誤'}`);
    }
  };

  const handleSubmit = async (question: PracticeQuestion) => {
    if (!activeLesson || !profile) {
      return;
    }
    const result = await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: activeLesson.id,
      questionId: question.id,
      response: answers[question.id] ?? '',
    });
    setAttempts(current => ({ ...current, [question.id]: result.attempt }));
    setStatusMessage(result.attempt.result.feedback);
    const nextReview = await getPracticeReviewQueue(profile.id);
    setReviewItems(nextReview);
  };

  const handleToggleBookmark = async (question: PracticeQuestion) => {
    if (!activeLesson || !profile) {
      return;
    }
    const key = `${activeLesson.id}:${question.id}`;
    if (bookmarks.has(key)) {
      await deletePracticeBookmark(profile.id, activeLesson.id, question.id);
      setBookmarks(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    } else {
      await savePracticeBookmark(profile.id, activeLesson.id, question.id);
      setBookmarks(current => new Set(current).add(key));
    }
    setReviewItems(await getPracticeReviewQueue(profile.id));
  };

  const renderQuestionEditor = (question: PracticeQuestion, index: number) => {
    const validationMessage = questionValidationMessage(question);
    return (
      <article key={question.id} className='rounded-xl border border-gray-700 bg-gray-900/70 p-4'>
        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
          <h4 className='font-semibold text-white'>題目 {index + 1}</h4>
          <span className='rounded-full border border-gray-600 px-2 py-1 text-xs text-gray-300'>
            {questionTypeLabels[question.type]}
          </span>
        </div>
        <label className='mb-3 block text-sm text-gray-300'>
          題幹
          <textarea
            className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
            value={question.prompt}
            onChange={event => updateDraftQuestion(question.id, { prompt: event.target.value })}
            rows={2}
          />
        </label>
        <label className='mb-3 block text-sm text-gray-300'>
          題型
          <select
            className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
            value={question.type}
            onChange={event =>
              updateDraftQuestion(question.id, { type: event.target.value as PracticeQuestionType })
            }
          >
            {PRACTICE_QUESTION_TYPES.map(type => (
              <option value={type} key={type}>
                {questionTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        {question.type === 'choice' && (
          <label className='mb-3 block text-sm text-gray-300'>
            選項（每行一個）
            <textarea
              className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
              value={(question.options ?? []).join('\n')}
              onChange={event =>
                updateDraftQuestion(question.id, {
                  options: event.target.value
                    .split('\n')
                    .map(value => value.trim())
                    .filter(Boolean),
                })
              }
              rows={3}
            />
          </label>
        )}
        {question.type !== 'free-response' && (
          <label className='mb-3 block text-sm text-gray-300'>
            正確答案
            <input
              className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
              value={question.answer ?? question.correctAnswer ?? ''}
              onChange={event =>
                updateDraftQuestion(question.id, {
                  answer: event.target.value,
                  correctAnswer: event.target.value,
                })
              }
            />
          </label>
        )}
        <label className='mb-3 block text-sm text-gray-300'>
          解說
          <textarea
            className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
            value={question.explanation}
            onChange={event =>
              updateDraftQuestion(question.id, { explanation: event.target.value })
            }
            rows={2}
          />
        </label>
        <div className='space-y-2'>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-sm font-medium text-gray-300'>來源（可由教師修正）</span>
            <button
              type='button'
              onClick={() => addQuestionSource(question.id)}
              className='rounded-md border border-gray-600 px-2 py-1 text-xs text-cyan-300 hover:bg-gray-800'
            >
              新增來源
            </button>
          </div>
          {question.sources.map(source => (
            <div
              key={source.id}
              className='grid gap-2 rounded-lg border border-gray-800 p-2 sm:grid-cols-2'
            >
              <label className='text-xs text-gray-400'>
                名稱
                <input
                  className='mt-1 w-full rounded border border-gray-700 bg-gray-950 p-1.5 text-sm text-white'
                  value={source.title}
                  onChange={event =>
                    updateQuestionSource(question.id, source.id, { title: event.target.value })
                  }
                />
              </label>
              <label className='text-xs text-gray-400'>
                狀態
                <select
                  className='mt-1 w-full rounded border border-gray-700 bg-gray-950 p-1.5 text-sm text-white'
                  value={source.status}
                  onChange={event =>
                    updateQuestionSource(question.id, source.id, {
                      status: event.target.value as PracticeSource['status'],
                    })
                  }
                >
                  <option value='unverified'>未驗證，請確認</option>
                  <option value='verified'>教師已確認</option>
                </select>
              </label>
              <label className='text-xs text-gray-400 sm:col-span-2'>
                頁碼／段落／網址
                <input
                  className='mt-1 w-full rounded border border-gray-700 bg-gray-950 p-1.5 text-sm text-white'
                  value={source.locator ?? source.url ?? ''}
                  onChange={event =>
                    updateQuestionSource(question.id, source.id, { locator: event.target.value })
                  }
                />
              </label>
              <p className='text-xs text-amber-300 sm:col-span-2'>
                {source.status === 'verified'
                  ? '教師已確認此來源；系統沒有替教師向外部網站驗證。'
                  : '未驗證來源：請教師補上或改正 provenance。'}
              </p>
            </div>
          ))}
        </div>
        {validationMessage && (
          <p className='mt-3 rounded-lg border border-amber-700/70 bg-amber-950/30 p-2 text-xs text-amber-200'>
            schema 無效：{validationMessage}。保存後仍不會對此題計分。
          </p>
        )}
      </article>
    );
  };

  const renderPracticeQuestion = (question: PracticeQuestion, index: number) => {
    const attempt = attempts[question.id];
    const key = activeLesson ? `${activeLesson.id}:${question.id}` : '';
    return (
      <article key={question.id} className='rounded-xl border border-gray-700 bg-gray-900/70 p-4'>
        <div className='mb-2 flex items-start justify-between gap-3'>
          <div>
            <p className='text-xs text-gray-500'>
              題目 {index + 1} · {questionTypeLabels[question.type]}
            </p>
            <h4 className='mt-1 text-base font-medium text-white'>{question.prompt}</h4>
          </div>
          <button
            type='button'
            aria-pressed={bookmarks.has(key)}
            onClick={() => void handleToggleBookmark(question)}
            className='rounded-md border border-gray-600 px-2 py-1 text-xs text-amber-200 hover:bg-gray-800'
          >
            {bookmarks.has(key) ? '★ 已收藏' : '☆ 收藏'}
          </button>
        </div>
        {question.type === 'choice' && (
          <div className='space-y-2'>
            {(question.options ?? []).map(option => (
              <label key={option} className='flex items-center gap-2 text-sm text-gray-200'>
                <input
                  type='radio'
                  name={`question-${question.id}`}
                  value={option}
                  checked={answers[question.id] === option}
                  onChange={event =>
                    setAnswers(current => ({ ...current, [question.id]: event.target.value }))
                  }
                />
                {option}
              </label>
            ))}
          </div>
        )}
        {question.type === 'fill' && (
          <input
            aria-label={`題目 ${index + 1} 的答案`}
            className='w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
            value={answers[question.id] ?? ''}
            onChange={event =>
              setAnswers(current => ({ ...current, [question.id]: event.target.value }))
            }
          />
        )}
        {question.type === 'free-response' && (
          <div>
            <textarea
              aria-label={`題目 ${index + 1} 的自由回答`}
              className='w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-white'
              value={answers[question.id] ?? ''}
              onChange={event =>
                setAnswers(current => ({ ...current, [question.id]: event.target.value }))
              }
              rows={3}
            />
            <p className='mt-1 text-xs text-violet-300'>
              人工／連線 AI 回饋：目前僅標記待人工批改，不會自動呼叫服務。
            </p>
          </div>
        )}
        <button
          type='button'
          onClick={() => void handleSubmit(question)}
          className='mt-3 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500'
        >
          送出答案
        </button>
        {attempt && (
          <p
            className={`mt-2 rounded-lg p-2 text-sm ${
              attempt.result.status === 'correct'
                ? 'bg-emerald-950/50 text-emerald-200'
                : attempt.result.status === 'ungraded-invalid'
                  ? 'bg-amber-950/50 text-amber-200'
                  : 'bg-gray-800 text-gray-200'
            }`}
            role='status'
          >
            {attempt.result.feedback}
          </p>
        )}
      </article>
    );
  };

  return (
    <section
      className={`h-full overflow-y-auto bg-gray-950 text-gray-100 ${className ?? ''}`}
      data-testid='practice-workspace'
      aria-label='備課與練習工作區'
    >
      <div className='mx-auto max-w-6xl space-y-6 p-4 md:p-8'>
        <header className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300'>
              F5 Practice
            </p>
            <h1 className='mt-1 text-2xl font-bold text-white md:text-3xl'>備課、練習與複習</h1>
            <p className='mt-2 max-w-3xl text-sm text-gray-400'>
              內容、題目、作答紀錄都保存在本機。自由回答只會標記人工／連線 AI
              回饋，不會在離線狀態假裝自動評分。
            </p>
          </div>
          {onClose && (
            <button
              type='button'
              onClick={onClose}
              className='rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800'
            >
              返回
            </button>
          )}
        </header>

        <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.7fr)]'>
          <section
            className='rounded-2xl border border-gray-800 bg-gray-900/60 p-4 md:p-5'
            aria-labelledby='practice-draft-heading'
          >
            <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 id='practice-draft-heading' className='text-lg font-semibold text-white'>
                  建立題組
                </h2>
                <p className='text-xs text-gray-400'>
                  年級、主題、學習目標先形成 mock 預覽，再由教師編輯並保存。
                </p>
              </div>
              <div className='flex items-center gap-2'>
                <label className='text-xs text-gray-400' htmlFor='practice-profile'>
                  本機 profile
                </label>
                <select
                  id='practice-profile'
                  className='rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white'
                  value={profile?.id ?? ''}
                  onChange={event => void handleProfileChange(event.target.value)}
                >
                  {profiles.map(item => (
                    <option value={item.id} key={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className='mb-4 flex flex-wrap gap-2'>
              <input
                aria-label='新增本機 profile 名稱'
                className='rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white'
                placeholder='新增 profile 名稱（匿名）'
                value={newProfileName}
                onChange={event => setNewProfileName(event.target.value)}
              />
              <button
                type='button'
                onClick={() => void handleCreateProfile()}
                className='rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800'
              >
                建立 profile
              </button>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='text-sm text-gray-300'>
                年級
                <input
                  className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white'
                  value={form.gradeLevel}
                  onChange={event =>
                    setForm(current => ({ ...current, gradeLevel: event.target.value }))
                  }
                />
              </label>
              <label className='text-sm text-gray-300'>
                科目
                <select
                  className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white'
                  value={form.subject}
                  onChange={event => {
                    const subject = event.target.value as PracticeSubject;
                    setForm(current => ({
                      ...current,
                      subject,
                      topic: PRACTICE_SUBJECT_FIXTURES[subject].defaultTopic,
                    }));
                  }}
                >
                  {PRACTICE_SUBJECTS.map(subject => (
                    <option value={subject} key={subject}>
                      {subjectLabels[subject]}
                    </option>
                  ))}
                </select>
              </label>
              <label className='text-sm text-gray-300 sm:col-span-2'>
                主題
                <input
                  className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white'
                  value={form.topic}
                  onChange={event =>
                    setForm(current => ({ ...current, topic: event.target.value }))
                  }
                />
              </label>
              <label className='text-sm text-gray-300 sm:col-span-2'>
                學習目標（每行一項）
                <textarea
                  className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white'
                  rows={3}
                  value={form.learningObjectives}
                  onChange={event =>
                    setForm(current => ({ ...current, learningObjectives: event.target.value }))
                  }
                />
              </label>
            </div>
            <button
              type='button'
              onClick={handleGeneratePreview}
              disabled={!profile}
              className='mt-4 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
            >
              產生題組預覽
            </button>
            {draft && (
              <div className='mt-5 space-y-4 border-t border-gray-800 pt-5'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <h3 className='text-base font-semibold text-cyan-200'>預覽與編輯</h3>
                  <button
                    type='button'
                    onClick={() => void handleSaveDraft()}
                    className='rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500'
                  >
                    保存教案
                  </button>
                </div>
                <label className='block text-sm text-gray-300'>
                  教案標題
                  <input
                    className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white'
                    value={draft.title}
                    onChange={event => updateDraft({ title: event.target.value })}
                  />
                </label>
                <label className='block text-sm text-gray-300'>
                  教學流程
                  <textarea
                    className='mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-white'
                    rows={3}
                    value={draft.lessonPlan}
                    onChange={event => updateDraft({ lessonPlan: event.target.value })}
                  />
                </label>
                <div className='space-y-3'>{draft.questions.map(renderQuestionEditor)}</div>
              </div>
            )}
          </section>

          <aside className='space-y-4'>
            <section
              className='rounded-2xl border border-gray-800 bg-gray-900/60 p-4'
              aria-labelledby='practice-library-heading'
            >
              <div className='mb-3 flex items-center justify-between gap-2'>
                <h2 id='practice-library-heading' className='text-lg font-semibold text-white'>
                  我的題組
                </h2>
                <span className='text-xs text-gray-500'>{lessons.length} 份</span>
              </div>
              {lessons.length === 0 ? (
                <p className='text-sm text-gray-400'>先建立一份題組預覽。</p>
              ) : (
                <div className='space-y-2'>
                  {lessons.map(lesson => (
                    <button
                      type='button'
                      key={lesson.id}
                      onClick={() => {
                        setSelectedLessonId(lesson.id);
                        setActiveLessonId(null);
                      }}
                      className={`w-full rounded-lg border p-3 text-left ${selectedLessonId === lesson.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-gray-700 hover:bg-gray-800'}`}
                    >
                      <span className='block text-sm font-medium text-white'>{lesson.title}</span>
                      <span className='mt-1 block text-xs text-gray-400'>
                        {subjectLabels[lesson.subject]} · {lesson.topic} · v{lesson.version}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section
              className='rounded-2xl border border-gray-800 bg-gray-900/60 p-4'
              aria-labelledby='practice-review-heading'
            >
              <h2 id='practice-review-heading' className='text-lg font-semibold text-white'>
                開啟時複習
              </h2>
              <p className='mt-1 text-xs text-gray-400'>
                只在開啟工作區時重新計算，不承諾背景通知。
              </p>
              {reviewItems.length === 0 ? (
                <p className='mt-3 text-sm text-gray-400'>目前沒有到期錯題或書籤。</p>
              ) : (
                <ul className='mt-3 space-y-2'>
                  {reviewItems.map(item => (
                    <li
                      key={item.id}
                      className='rounded-lg border border-amber-800/60 bg-amber-950/20 p-2 text-xs text-amber-100'
                    >
                      {item.reason === 'mistake' ? '錯題' : '書籤'} ·{' '}
                      {item.question?.prompt ?? '題目已被移除'}
                      <span className='mt-1 block text-amber-300'>
                        排程：{formatTime(item.nextReviewAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section
              className='rounded-2xl border border-gray-800 bg-gray-900/60 p-4'
              aria-label='匯出匯入'
            >
              <h2 className='text-lg font-semibold text-white'>交換與列印</h2>
              <p className='mt-1 text-xs text-gray-400'>
                教學分享預設不含 profile、作答、錯題與書籤。完整備份供 F1 使用。
              </p>
              <div className='mt-3 flex flex-wrap gap-2'>
                <button
                  type='button'
                  onClick={() => void downloadPracticeJson('teaching-share', profile?.id)}
                  className='rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
                >
                  匯出教學 JSON
                </button>
                <button
                  type='button'
                  onClick={() => void downloadPracticeJson('f1-backup')}
                  className='rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
                >
                  匯出完整備份
                </button>
                <button
                  type='button'
                  onClick={() => fileInputRef.current?.click()}
                  className='rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
                >
                  匯入 JSON 副本
                </button>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='application/json,.json'
                  className='hidden'
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleImport(file);
                    }
                    event.target.value = '';
                  }}
                />
                {selectedLesson && (
                  <button
                    type='button'
                    onClick={() => downloadPracticeMarkdown(selectedLesson)}
                    className='rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
                  >
                    匯出 Markdown
                  </button>
                )}
                {selectedLesson && (
                  <button
                    type='button'
                    onClick={() => window.print()}
                    className='rounded-lg border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800'
                  >
                    列印目前教案
                  </button>
                )}
              </div>
              {importError && (
                <p
                  className='mt-3 rounded-lg border border-red-700/60 bg-red-950/30 p-2 text-xs text-red-200'
                  role='alert'
                >
                  {importError}
                </p>
              )}
            </section>
          </aside>
        </div>

        {selectedLesson && !activeLesson && (
          <section
            className='rounded-2xl border border-gray-800 bg-gray-900/60 p-4 md:p-5'
            aria-labelledby='practice-preview-heading'
          >
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <h2 id='practice-preview-heading' className='text-xl font-semibold text-white'>
                  {selectedLesson.title}
                </h2>
                <p className='mt-1 text-sm text-gray-400'>
                  {subjectLabels[selectedLesson.subject]} · {selectedLesson.gradeLevel} ·{' '}
                  {selectedLesson.topic}
                </p>
              </div>
              <button
                type='button'
                onClick={() => {
                  setActiveLessonId(selectedLesson.id);
                  setAnswers({});
                  setStatusMessage('已進入離線練習。');
                }}
                className='rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500'
              >
                開始練習
              </button>
            </div>
            <p className='mt-4 whitespace-pre-wrap text-sm text-gray-300'>
              {selectedLesson.lessonPlan}
            </p>
            <ul className='mt-4 grid gap-2 sm:grid-cols-2'>
              {selectedLesson.learningObjectives.map(objective => (
                <li key={objective} className='rounded-lg bg-gray-800/70 p-2 text-sm text-gray-300'>
                  目標：{objective}
                </li>
              ))}
            </ul>
            <div className='mt-4 grid gap-3 md:grid-cols-3'>
              {selectedLesson.questions.map((question, index) => (
                <div
                  key={question.id}
                  className='rounded-lg border border-gray-700 p-3 text-sm text-gray-300'
                >
                  <span className='text-xs text-gray-500'>題目 {index + 1}</span>
                  <p className='mt-1'>{question.prompt}</p>
                  <p className='mt-2 text-xs text-amber-300'>
                    {question.sources.some(source => source.status === 'unverified')
                      ? '含未驗證來源'
                      : '來源已由教師標記確認'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeLesson && (
          <section
            className='rounded-2xl border border-cyan-900/60 bg-gray-900/80 p-4 md:p-5'
            aria-labelledby='practice-active-heading'
          >
            <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 id='practice-active-heading' className='text-xl font-semibold text-white'>
                  練習：{activeLesson.title}
                </h2>
                <p className='mt-1 text-xs text-gray-400'>
                  選擇／填空離線核對；自由回答明確標為人工／連線 AI 回饋。
                </p>
              </div>
              <button
                type='button'
                onClick={() => setActiveLessonId(null)}
                className='rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800'
              >
                離開練習
              </button>
            </div>
            <div className='space-y-3'>{activeLesson.questions.map(renderPracticeQuestion)}</div>
          </section>
        )}

        <p className='min-h-6 text-sm text-cyan-200' role='status' aria-live='polite'>
          {statusMessage}
        </p>
      </div>
    </section>
  );
};

export { PracticeWorkspace };
export default PracticeWorkspace;

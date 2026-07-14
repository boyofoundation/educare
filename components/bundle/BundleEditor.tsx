import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantEditor } from '../assistant';
import { validateBundle } from '../../services/agentBundleService';
import { bundleStrings } from './bundleStrings';
import type { AgentBundle, AgentBundleAgent, AgentBundleRoute, Assistant } from '../../types';

interface BundleEditorProps {
  bundle: AgentBundle;
  onSave: (bundle: AgentBundle) => Promise<void>;
  onCancel: () => void;
}

const toAssistant = (
  agent: AgentBundleAgent,
  routes: AgentBundleRoute[],
  createdAt: number,
): Assistant => ({
  id: agent.id,
  name: agent.name,
  description: agent.description,
  systemPrompt: agent.systemPrompt,
  starterPrompts: [...agent.starterPrompts],
  ragChunks: agent.ragChunks.map(({ fileName, content }) => ({ fileName, content })),
  createdAt,
  subagentDelegationEnabled: false,
  mathToolsEnabled: agent.mathToolsEnabled ?? false,
  webSpeechToolsEnabled: agent.webSpeechToolsEnabled ?? false,
  routableAssistantIds: routes
    .filter(route => route.fromAgentId === agent.id)
    .map(route => route.toAgentId),
});

const toBundleAgent = (assistant: Assistant, original: AgentBundleAgent): AgentBundleAgent => ({
  id: original.id,
  name: assistant.name,
  description: assistant.description,
  systemPrompt: assistant.systemPrompt,
  starterPrompts: [...(assistant.starterPrompts ?? [])],
  ragChunks: (assistant.ragChunks ?? []).map(({ fileName, content }) => ({ fileName, content })),
  ...(original.icon === undefined ? {} : { icon: original.icon }),
  ...(original.modelParams === undefined ? {} : { modelParams: { ...original.modelParams } }),
  ...(assistant.mathToolsEnabled ? { mathToolsEnabled: true } : {}),
  ...(assistant.webSpeechToolsEnabled ? { webSpeechToolsEnabled: true } : {}),
});

const areAgentsEqual = (left: AgentBundleAgent, right: AgentBundleAgent): boolean =>
  JSON.stringify({
    id: left.id,
    name: left.name,
    description: left.description,
    systemPrompt: left.systemPrompt,
    starterPrompts: left.starterPrompts,
    ragChunks: left.ragChunks,
    icon: left.icon,
    modelParams: {
      temperature: left.modelParams?.temperature,
      maxOutputTokens: left.modelParams?.maxOutputTokens,
    },
    mathToolsEnabled: left.mathToolsEnabled ?? false,
    webSpeechToolsEnabled: left.webSpeechToolsEnabled ?? false,
  }) ===
  JSON.stringify({
    id: right.id,
    name: right.name,
    description: right.description,
    systemPrompt: right.systemPrompt,
    starterPrompts: right.starterPrompts,
    ragChunks: right.ragChunks,
    icon: right.icon,
    modelParams: {
      temperature: right.modelParams?.temperature,
      maxOutputTokens: right.modelParams?.maxOutputTokens,
    },
    mathToolsEnabled: right.mathToolsEnabled ?? false,
    webSpeechToolsEnabled: right.webSpeechToolsEnabled ?? false,
  });

const areRoutesEqual = (left: AgentBundleRoute[], right: AgentBundleRoute[]): boolean =>
  left.length === right.length &&
  left.every(
    (route, index) =>
      route.fromAgentId === right[index]?.fromAgentId &&
      route.toAgentId === right[index]?.toAgentId &&
      route.condition === right[index]?.condition,
  );

const applyAssistantDraft = (
  currentAgents: AgentBundleAgent[],
  currentRoutes: AgentBundleRoute[],
  sourceAgentId: string,
  assistant: Assistant,
): { agents: AgentBundleAgent[]; routes: AgentBundleRoute[] } => {
  const originalAgent = currentAgents.find(agent => agent.id === sourceAgentId);
  if (!originalAgent) {
    return { agents: currentAgents, routes: currentRoutes };
  }

  const nextAgent = toBundleAgent(assistant, originalAgent);
  const nextAgents = areAgentsEqual(originalAgent, nextAgent)
    ? currentAgents
    : currentAgents.map(agent => (agent.id === sourceAgentId ? nextAgent : agent));
  const existingConditions = new Map(
    currentRoutes
      .filter(route => route.fromAgentId === sourceAgentId)
      .map(route => [route.toAgentId, route.condition]),
  );
  const nextRoutes = currentRoutes.filter(route => route.fromAgentId !== sourceAgentId);
  const targets = new Set(assistant.routableAssistantIds ?? []);
  for (const targetId of targets) {
    if (targetId === sourceAgentId || !currentAgents.some(agent => agent.id === targetId)) {
      continue;
    }
    nextRoutes.push({
      fromAgentId: sourceAgentId,
      toAgentId: targetId,
      ...(existingConditions.get(targetId) === undefined
        ? {}
        : { condition: existingConditions.get(targetId) }),
    });
  }

  return {
    agents: nextAgents,
    routes: areRoutesEqual(currentRoutes, nextRoutes) ? currentRoutes : nextRoutes,
  };
};

const BundleEditor: React.FC<BundleEditorProps> = ({ bundle, onSave, onCancel }) => {
  const [name, setName] = useState(bundle.manifest.name);
  const [description, setDescription] = useState(bundle.manifest.description);
  const [version, setVersion] = useState(bundle.manifest.version);
  const [entryAgentId, setEntryAgentId] = useState(bundle.manifest.entryAgentId);
  const [agents, setAgents] = useState<AgentBundleAgent[]>(bundle.agents);
  const [routes, setRoutes] = useState<AgentBundleRoute[]>(bundle.routes);
  const [selectedAgentId, setSelectedAgentId] = useState(bundle.agents[0]?.id ?? '');
  const [assistantSearch, setAssistantSearch] = useState('');
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeConditionsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setName(bundle.manifest.name);
    setDescription(bundle.manifest.description);
    setVersion(bundle.manifest.version);
    setEntryAgentId(bundle.manifest.entryAgentId);
    setAgents(bundle.agents);
    setRoutes(bundle.routes);
    setSelectedAgentId(bundle.agents[0]?.id ?? '');
    setAssistantSearch('');
    setBatchSelectedIds(new Set());
    setError(null);
  }, [bundle]);

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );

  const selectedAssistant = useMemo(
    () => (selectedAgent ? toAssistant(selectedAgent, routes, bundle.manifest.exportedAt) : null),
    [bundle.manifest.exportedAt, routes, selectedAgent],
  );

  const editableAssistants = useMemo(
    () => agents.map(agent => toAssistant(agent, routes, bundle.manifest.exportedAt)),
    [agents, bundle.manifest.exportedAt, routes],
  );

  const filteredAgents = useMemo(() => {
    const query = assistantSearch.trim().toLocaleLowerCase('zh-Hant');
    if (!query) {
      return agents;
    }
    return agents.filter(agent =>
      `${agent.name} ${agent.description}`.toLocaleLowerCase('zh-Hant').includes(query),
    );
  }, [agents, assistantSearch]);

  const routesByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      counts.set(route.fromAgentId, (counts.get(route.fromAgentId) ?? 0) + 1);
    }
    return counts;
  }, [routes]);

  const hasChanges = useMemo(
    () =>
      JSON.stringify({
        name: name.trim(),
        description: description.trim(),
        version: version.trim(),
        entryAgentId,
        agents,
        routes,
      }) !==
      JSON.stringify({
        name: bundle.manifest.name,
        description: bundle.manifest.description,
        version: bundle.manifest.version,
        entryAgentId: bundle.manifest.entryAgentId,
        agents: bundle.agents,
        routes: bundle.routes,
      }),
    [agents, bundle, description, entryAgentId, name, routes, version],
  );

  const batchSelectionCount = batchSelectedIds.size;

  const updateBatchTool = useCallback(
    (tool: 'math' | 'speech', enabled: boolean) => {
      if (batchSelectedIds.size === 0) {
        return;
      }
      setAgents(current =>
        current.map(agent => {
          if (!batchSelectedIds.has(agent.id)) {
            return agent;
          }
          if (tool === 'math') {
            return { ...agent, mathToolsEnabled: enabled ? true : undefined };
          }
          return { ...agent, webSpeechToolsEnabled: enabled ? true : undefined };
        }),
      );
    },
    [batchSelectedIds],
  );

  const handleAgentDraftChange = useCallback(
    (assistant: Assistant) => {
      const sourceAgentId = selectedAgentId;
      if (!sourceAgentId) {
        return;
      }

      const next = applyAssistantDraft(agents, routes, sourceAgentId, assistant);
      setAgents(next.agents);
      setRoutes(next.routes);
    },
    [agents, routes, selectedAgentId],
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError(bundleStrings.editor.nameRequired);
      return;
    }

    const nextBundle: AgentBundle = {
      ...bundle,
      manifest: {
        ...bundle.manifest,
        name: name.trim(),
        description: description.trim(),
        version: version.trim(),
        entryAgentId,
      },
      agents,
      routes,
    };
    const validation = validateBundle(nextBundle);
    if (validation.errors.length > 0) {
      setError(validation.errors.map(issue => issue.message).join(' '));
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSave(nextBundle);
    } catch (saveError) {
      setError((saveError as Error).message || bundleStrings.editor.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }, [agents, bundle, description, entryAgentId, name, onSave, routes, version]);

  return (
    <div
      data-testid='bundle-editor'
      className='flex h-full min-h-0 flex-col overflow-hidden bg-[#0f151c] text-gray-100'
    >
      <header className='shrink-0 border-b border-slate-700/70 bg-[#111923]/95 backdrop-blur'>
        <div className='mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-6'>
          <div className='min-w-0'>
            <p className='mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80'>
              BUNDLE / EDITOR
            </p>
            <div className='flex min-w-0 items-center gap-3'>
              <h2 className='truncate text-xl font-semibold text-white sm:text-2xl'>
                {bundleStrings.editor.title}
              </h2>
              <span className='hidden shrink-0 text-sm text-slate-500 sm:inline'>/</span>
              <span className='hidden max-w-60 truncate text-sm text-slate-300 sm:inline'>
                {name || '未命名協作包'}
              </span>
            </div>
            <p className='mt-1 hidden text-sm text-slate-400 md:block'>
              {bundleStrings.editor.subtitle}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <span
              data-testid='editor-dirty-state'
              aria-live='polite'
              className={`hidden text-xs sm:inline ${
                hasChanges ? 'text-amber-300' : 'text-emerald-300'
              }`}
            >
              {hasChanges ? bundleStrings.editor.changesPending : bundleStrings.editor.changesSaved}
            </span>
            <button
              type='button'
              onClick={onCancel}
              className='rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-400 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70'
            >
              {bundleStrings.import.cancel}
            </button>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={isSaving || agents.length === 0}
              className='rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white shadow-sm shadow-cyan-950/40 transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isSaving ? bundleStrings.editor.saving : bundleStrings.editor.save}
            </button>
          </div>
        </div>
      </header>

      <main className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6'>
          <section
            aria-label={bundleStrings.editor.settings}
            className='mb-6 border-b border-slate-800 pb-6'
          >
            <div className='mb-4 flex flex-wrap items-baseline justify-between gap-2'>
              <div>
                <h3 className='text-sm font-semibold text-slate-100'>
                  {bundleStrings.editor.settings}
                </h3>
                <p className='mt-1 text-xs text-slate-500'>調整協作包識別資訊與接待入口。</p>
              </div>
              <span className='text-xs text-slate-500'>
                {bundleStrings.editor.assistantCount(agents.length)}
              </span>
            </div>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
              <label>
                <span className='mb-1.5 block text-xs font-medium text-slate-400'>
                  {bundleStrings.editor.name}
                </span>
                <input
                  aria-label={bundleStrings.editor.name}
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className='w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40'
                />
              </label>
              <label>
                <span className='mb-1.5 block text-xs font-medium text-slate-400'>
                  {bundleStrings.editor.version}
                </span>
                <input
                  aria-label={`協作包${bundleStrings.editor.version}`}
                  value={version}
                  onChange={event => setVersion(event.target.value)}
                  className='w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40'
                />
              </label>
              <label>
                <span className='mb-1.5 block text-xs font-medium text-slate-400'>
                  {bundleStrings.editor.entryAgent}
                </span>
                <select
                  aria-label={bundleStrings.editor.entryAgentLabel}
                  value={entryAgentId}
                  onChange={event => setEntryAgentId(event.target.value)}
                  className='w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40'
                >
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className='mt-4 block'>
              <span className='mb-1.5 block text-xs font-medium text-slate-400'>
                {bundleStrings.editor.description}
              </span>
              <textarea
                aria-label={bundleStrings.editor.description}
                value={description}
                onChange={event => setDescription(event.target.value)}
                rows={2}
                className='w-full resize-y rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40'
              />
            </label>
          </section>

          <div className='grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start'>
            <aside
              aria-label={bundleStrings.editor.agents}
              className='overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/55 lg:sticky lg:top-4'
            >
              <div className='border-b border-slate-800 px-3.5 py-3'>
                <div className='flex items-center justify-between gap-2'>
                  <h3 className='text-sm font-semibold text-slate-100'>
                    {bundleStrings.editor.agents}
                  </h3>
                  <span className='text-xs text-slate-500'>
                    {bundleStrings.editor.assistantCount(agents.length)}
                  </span>
                </div>
                <p className='mt-1 text-xs leading-5 text-slate-500'>
                  {bundleStrings.editor.assistantNavHint}
                </p>
                <label className='relative mt-3 block'>
                  <span className='sr-only'>{bundleStrings.editor.assistantSearch}</span>
                  <input
                    aria-label={bundleStrings.editor.assistantSearch}
                    value={assistantSearch}
                    onChange={event => setAssistantSearch(event.target.value)}
                    placeholder={bundleStrings.editor.assistantSearchPlaceholder}
                    className='w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40'
                  />
                </label>
              </div>

              <div className='max-h-[min(52vh,34rem)] overflow-y-auto p-2'>
                {filteredAgents.length === 0 ? (
                  <p className='px-2 py-5 text-center text-xs text-slate-500'>
                    {bundleStrings.editor.noSearchResults}
                  </p>
                ) : (
                  <ul className='space-y-1'>
                    {filteredAgents.map(agent => {
                      const active = selectedAgent?.id === agent.id;
                      const needsReview = !agent.name.trim() || !agent.systemPrompt.trim();
                      const toolCount =
                        Number(Boolean(agent.mathToolsEnabled)) +
                        Number(Boolean(agent.webSpeechToolsEnabled));
                      return (
                        <li key={agent.id} className='flex items-stretch gap-1 rounded-lg'>
                          <input
                            type='checkbox'
                            aria-label={bundleStrings.editor.batchSelectLabel(agent.name)}
                            checked={batchSelectedIds.has(agent.id)}
                            onChange={event => {
                              setBatchSelectedIds(current => {
                                const next = new Set(current);
                                if (event.target.checked) {
                                  next.add(agent.id);
                                } else {
                                  next.delete(agent.id);
                                }
                                return next;
                              });
                            }}
                            className='ml-1 h-4 w-4 self-center rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-500/50'
                          />
                          <button
                            type='button'
                            aria-pressed={active}
                            onClick={() => setSelectedAgentId(agent.id)}
                            className={`min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
                              active
                                ? 'border-cyan-500/70 bg-cyan-500/10'
                                : 'border-transparent hover:border-slate-700 hover:bg-slate-800/70'
                            }`}
                          >
                            <span className='flex items-start gap-2'>
                              <span
                                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                                  active
                                    ? 'bg-cyan-500/20 text-cyan-200'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {agents.findIndex(item => item.id === agent.id) + 1}
                              </span>
                              <span className='min-w-0 flex-1'>
                                <span className='flex items-center gap-1.5'>
                                  <span
                                    className={`min-w-0 flex-1 truncate text-sm font-medium ${active ? 'text-cyan-100' : 'text-slate-200'}`}
                                  >
                                    {agent.name || '未命名助理'}
                                  </span>
                                  {agent.id === entryAgentId && (
                                    <span className='shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200'>
                                      {bundleStrings.editor.entryBadge}
                                    </span>
                                  )}
                                </span>
                                <span className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500'>
                                  <span
                                    className={needsReview ? 'text-amber-300' : 'text-emerald-300'}
                                  >
                                    {needsReview
                                      ? bundleStrings.editor.assistantNeedsReview
                                      : bundleStrings.editor.assistantReady}
                                  </span>
                                  <span>
                                    {bundleStrings.editor.knowledgeCount(agent.ragChunks.length)}
                                  </span>
                                  <span>
                                    {bundleStrings.editor.routeCount(
                                      routesByAgent.get(agent.id) ?? 0,
                                    )}
                                  </span>
                                  {toolCount > 0 && <span>{toolCount} 個工具</span>}
                                </span>
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div data-testid='batch-tools' className='border-t border-slate-800 px-3.5 py-3'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-xs font-medium text-slate-300'>
                    {bundleStrings.editor.batchTitle}
                  </span>
                  <span className='text-[10px] text-slate-500'>
                    {bundleStrings.editor.batchSelected(batchSelectionCount)}
                  </span>
                </div>
                <div className='mt-2 flex gap-2'>
                  <button
                    type='button'
                    onClick={() => setBatchSelectedIds(new Set(agents.map(agent => agent.id)))}
                    className='text-[11px] text-cyan-300 transition hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70'
                  >
                    {bundleStrings.editor.batchSelectAll}
                  </button>
                  <button
                    type='button'
                    onClick={() => setBatchSelectedIds(new Set())}
                    className='text-[11px] text-slate-400 transition hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70'
                  >
                    {bundleStrings.editor.batchClear}
                  </button>
                </div>
                <div className='mt-3 grid grid-cols-2 gap-2'>
                  <button
                    type='button'
                    disabled={batchSelectionCount === 0}
                    onClick={() => updateBatchTool('math', true)}
                    className='rounded-md border border-slate-700 bg-slate-950/50 px-2 py-2 text-[11px] text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    {bundleStrings.editor.batchMathEnable}
                  </button>
                  <button
                    type='button'
                    disabled={batchSelectionCount === 0}
                    onClick={() => updateBatchTool('speech', true)}
                    className='rounded-md border border-slate-700 bg-slate-950/50 px-2 py-2 text-[11px] text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    {bundleStrings.editor.batchSpeechEnable}
                  </button>
                  <button
                    type='button'
                    disabled={batchSelectionCount === 0}
                    onClick={() => updateBatchTool('math', false)}
                    className='rounded-md border border-slate-800 px-2 py-1.5 text-[10px] text-slate-500 transition hover:border-slate-600 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    {bundleStrings.editor.batchMathDisable}
                  </button>
                  <button
                    type='button'
                    disabled={batchSelectionCount === 0}
                    onClick={() => updateBatchTool('speech', false)}
                    className='rounded-md border border-slate-800 px-2 py-1.5 text-[10px] text-slate-500 transition hover:border-slate-600 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    {bundleStrings.editor.batchSpeechDisable}
                  </button>
                </div>
              </div>

              <button
                type='button'
                onClick={() =>
                  routeConditionsRef.current?.scrollIntoView?.({
                    behavior: 'smooth',
                    block: 'start',
                  })
                }
                className='flex w-full items-center justify-between border-t border-slate-800 px-3.5 py-3 text-left text-sm text-slate-300 transition hover:bg-slate-800/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/70'
              >
                <span>{bundleStrings.editor.routingShortcut}</span>
                <span className='text-xs text-slate-500'>
                  {bundleStrings.editor.routingCount(routes.length)}
                </span>
              </button>
            </aside>

            <div className='min-w-0'>
              {selectedAgent && selectedAssistant && (
                <section
                  aria-label={bundleStrings.editor.editorWorkspace}
                  className='overflow-hidden rounded-lg border border-slate-700/80 bg-slate-800/25 shadow-xl shadow-black/10'
                >
                  <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 bg-slate-800/55 px-4 py-3'>
                    <div className='min-w-0'>
                      <p className='text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500'>
                        {bundleStrings.editor.currentAssistant}
                      </p>
                      <h3 className='mt-1 truncate text-base font-semibold text-white'>
                        {selectedAgent.name}
                      </h3>
                    </div>
                    <button
                      type='button'
                      onClick={() =>
                        routeConditionsRef.current?.scrollIntoView?.({
                          behavior: 'smooth',
                          block: 'start',
                        })
                      }
                      className='rounded-md border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-500/60 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70'
                    >
                      {bundleStrings.editor.openRouting}
                    </button>
                  </div>
                  <AssistantEditor
                    assistant={selectedAssistant}
                    availableAssistants={editableAssistants}
                    onSave={handleAgentDraftChange}
                    onDraftChange={handleAgentDraftChange}
                    showFooterActions={false}
                    compact
                    onCancel={() => undefined}
                  />
                </section>
              )}

              <section
                ref={routeConditionsRef}
                id='bundle-route-conditions'
                aria-label={bundleStrings.editor.routeConditions}
                className='mt-5 scroll-mt-5 overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/55'
              >
                <div className='border-b border-slate-800 px-4 py-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <h3 className='text-sm font-semibold text-slate-100'>
                      {bundleStrings.editor.routeConditions}
                    </h3>
                    <span className='text-xs text-slate-500'>
                      {bundleStrings.editor.routingCount(routes.length)}
                    </span>
                  </div>
                  <p className='mt-1 text-xs text-slate-500'>
                    每條規則只描述從一位助理轉向另一位助理的觸發條件。
                  </p>
                </div>
                <div className='p-4'>
                  {routes.length === 0 ? (
                    <p className='text-sm text-slate-500'>{bundleStrings.editor.noRoutes}</p>
                  ) : (
                    <div className='grid gap-3 xl:grid-cols-2'>
                      {routes.map(route => {
                        const source = agents.find(agent => agent.id === route.fromAgentId);
                        const target = agents.find(agent => agent.id === route.toAgentId);
                        return (
                          <label
                            key={`${route.fromAgentId}:${route.toAgentId}`}
                            className='rounded-lg border border-slate-800 bg-slate-950/45 p-3'
                          >
                            <span className='mb-2 block text-xs font-medium text-slate-300'>
                              {source?.name ?? route.fromAgentId}{' '}
                              <span className='px-1 text-cyan-400'>→</span>{' '}
                              {target?.name ?? route.toAgentId}
                            </span>
                            <input
                              type='text'
                              value={route.condition ?? ''}
                              onChange={event => {
                                const condition = event.target.value;
                                setRoutes(current =>
                                  current.map(item =>
                                    item.fromAgentId === route.fromAgentId &&
                                    item.toAgentId === route.toAgentId
                                      ? { ...item, condition: condition.trim() || undefined }
                                      : item,
                                  ),
                                );
                              }}
                              placeholder={bundleStrings.editor.routeConditionPlaceholder}
                              className='w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40'
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              {error && (
                <p
                  role='alert'
                  className='mt-5 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200'
                >
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default BundleEditor;

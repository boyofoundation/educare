import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const BundleEditor: React.FC<BundleEditorProps> = ({ bundle, onSave, onCancel }) => {
  const [name, setName] = useState(bundle.manifest.name);
  const [description, setDescription] = useState(bundle.manifest.description);
  const [version, setVersion] = useState(bundle.manifest.version);
  const [entryAgentId, setEntryAgentId] = useState(bundle.manifest.entryAgentId);
  const [agents, setAgents] = useState<AgentBundleAgent[]>(bundle.agents);
  const [routes, setRoutes] = useState<AgentBundleRoute[]>(bundle.routes);
  const [selectedAgentId, setSelectedAgentId] = useState(bundle.agents[0]?.id ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(bundle.manifest.name);
    setDescription(bundle.manifest.description);
    setVersion(bundle.manifest.version);
    setEntryAgentId(bundle.manifest.entryAgentId);
    setAgents(bundle.agents);
    setRoutes(bundle.routes);
    setSelectedAgentId(bundle.agents[0]?.id ?? '');
    setError(null);
  }, [bundle]);

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );

  const editableAssistants = useMemo(
    () => agents.map(agent => toAssistant(agent, routes, bundle.manifest.exportedAt)),
    [agents, bundle.manifest.exportedAt, routes],
  );

  const handleAgentDraftChange = useCallback(
    (assistant: Assistant) => {
      const sourceAgentId = selectedAgentId;
      if (!sourceAgentId) {
        return;
      }

      setAgents(current => {
        const originalAgent = current.find(agent => agent.id === sourceAgentId);
        if (!originalAgent) {
          return current;
        }
        const nextAgent = toBundleAgent(assistant, originalAgent);
        return areAgentsEqual(originalAgent, nextAgent)
          ? current
          : current.map(agent => (agent.id === sourceAgentId ? nextAgent : agent));
      });
      setRoutes(current => {
        const existingConditions = new Map(
          current
            .filter(route => route.fromAgentId === sourceAgentId)
            .map(route => [route.toAgentId, route.condition]),
        );
        const nextRoutes = current.filter(route => route.fromAgentId !== sourceAgentId);
        const targets = new Set(assistant.routableAssistantIds ?? []);
        for (const targetId of targets) {
          if (targetId === sourceAgentId || !agents.some(agent => agent.id === targetId)) {
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
        return areRoutesEqual(current, nextRoutes) ? current : nextRoutes;
      });
    },
    [agents, selectedAgentId],
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
    <div data-testid='bundle-editor' className='h-full overflow-y-auto bg-gray-900'>
      <div className='mx-auto max-w-5xl p-6 md:p-8'>
        <div className='sticky top-0 z-10 mb-6 flex items-center justify-between gap-4 border-b border-gray-800 bg-gray-900/95 py-3 backdrop-blur'>
          <div>
            <h2 className='mb-1.5 text-2xl font-bold text-white md:text-3xl'>
              {bundleStrings.editor.title}
            </h2>
            <p className='text-sm text-gray-400'>{bundleStrings.editor.subtitle}</p>
          </div>
          <div className='flex shrink-0 gap-2'>
            <button
              type='button'
              onClick={onCancel}
              className='rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 transition hover:bg-gray-800'
            >
              {bundleStrings.import.cancel}
            </button>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={isSaving || agents.length === 0}
              className='rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isSaving ? bundleStrings.editor.saving : bundleStrings.editor.save}
            </button>
          </div>
        </div>

        <section aria-label={bundleStrings.editor.settings} className='mb-6 space-y-4'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
            <label>
              <span className='mb-1 block text-xs font-medium text-gray-400'>
                {bundleStrings.editor.name}
              </span>
              <input
                aria-label={bundleStrings.editor.name}
                value={name}
                onChange={event => setName(event.target.value)}
                className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
              />
            </label>
            <label>
              <span className='mb-1 block text-xs font-medium text-gray-400'>
                {bundleStrings.editor.version}
              </span>
              <input
                aria-label={`協作包${bundleStrings.editor.version}`}
                value={version}
                onChange={event => setVersion(event.target.value)}
                className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
              />
            </label>
            <label>
              <span className='mb-1 block text-xs font-medium text-gray-400'>
                {bundleStrings.editor.entryAgent}
              </span>
              <select
                aria-label={bundleStrings.editor.entryAgentLabel}
                value={entryAgentId}
                onChange={event => setEntryAgentId(event.target.value)}
                className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
              >
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className='block'>
            <span className='mb-1 block text-xs font-medium text-gray-400'>
              {bundleStrings.editor.description}
            </span>
            <textarea
              aria-label={bundleStrings.editor.description}
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={2}
              className='w-full resize-y rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
            />
          </label>
        </section>

        <section aria-label={bundleStrings.editor.agents} className='mb-6'>
          <h3 className='mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400'>
            {bundleStrings.editor.agents}
          </h3>
          <div className='flex flex-wrap gap-2'>
            {agents.map(agent => (
              <button
                key={agent.id}
                type='button'
                aria-pressed={selectedAgent?.id === agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                  selectedAgent?.id === agent.id
                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-100'
                    : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-500'
                }`}
              >
                {agent.name}
                {agent.id === entryAgentId && (
                  <span className='ml-2 text-xs'>{bundleStrings.editor.entryBadge}</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {selectedAgent && (
          <AssistantEditor
            assistant={toAssistant(selectedAgent, routes, bundle.manifest.exportedAt)}
            availableAssistants={editableAssistants}
            onSave={handleAgentDraftChange}
            onDraftChange={handleAgentDraftChange}
            showFooterActions={false}
            onCancel={() => undefined}
          />
        )}

        <section
          aria-label={bundleStrings.editor.routeConditions}
          className='mt-6 border-t border-gray-800 pt-6'
        >
          <h3 className='mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400'>
            {bundleStrings.editor.routeConditions}
          </h3>
          {routes.length === 0 ? (
            <p className='text-sm text-gray-500'>{bundleStrings.editor.noRoutes}</p>
          ) : (
            <div className='space-y-3'>
              {routes.map(route => {
                const source = agents.find(agent => agent.id === route.fromAgentId);
                const target = agents.find(agent => agent.id === route.toAgentId);
                return (
                  <label key={`${route.fromAgentId}:${route.toAgentId}`} className='block'>
                    <span className='mb-1 block text-sm text-gray-300'>
                      {source?.name ?? route.fromAgentId} → {target?.name ?? route.toAgentId}
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
                      className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
                    />
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {error && (
          <p
            role='alert'
            className='mt-6 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200'
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default BundleEditor;

import { Cpu, Sparkles, Bot, Cloud, Zap } from 'lucide-react';
import type { ModelGroup, ModelProvider } from '../../types';

interface ModelSelectorProps {
  models: ModelGroup[];
  selectedModel: string;
  selectedProvider: ModelProvider;
  onSelect: (model: string, provider: ModelProvider) => void;
  isLoading?: boolean;
}

const providerIcons: Record<ModelProvider, React.ReactNode> = {
  ollama: <Cpu className="w-4 h-4" />,
  openai: <Sparkles className="w-4 h-4" />,
  anthropic: <Bot className="w-4 h-4" />,
  google: <Cloud className="w-4 h-4" />,
  groq: <Zap className="w-4 h-4" />,
};

const providerColors: Record<ModelProvider, string> = {
  ollama: 'text-glow',
  openai: 'text-green-400',
  anthropic: 'text-orange-400',
  google: 'text-blue-400',
  groq: 'text-purple-400',
};

const providerLabels: Record<ModelProvider, string> = {
  ollama: 'Ollama (Local)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  groq: 'Groq',
};

export function ModelSelector({
  models,
  selectedModel,
  selectedProvider,
  onSelect,
  isLoading,
}: ModelSelectorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [provider, model] = e.target.value.split('::');
    onSelect(model, provider as ModelProvider);
  };

  const currentValue = `${selectedProvider}::${selectedModel}`;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider font-[family-name:var(--font-display)] px-1">
        Model
      </h3>

      <div className="relative">
        <select
          value={currentValue}
          onChange={handleChange}
          disabled={isLoading}
          className={`
            w-full appearance-none
            px-3 py-2.5 pr-10
            bg-void-light text-text rounded-lg
            border border-void-surface
            font-[family-name:var(--font-body)] text-sm
            transition-all duration-200
            hover:border-text-dim
            focus:outline-none focus:border-glow focus:ring-1 focus:ring-glow/30
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {models.map((group) => (
            <optgroup
              key={group.provider}
              label={providerLabels[group.provider] || group.provider}
              className="bg-void-light text-text"
            >
              {group.models.map((model) => (
                <option
                  key={`${group.provider}::${model.name}`}
                  value={`${group.provider}::${model.name}`}
                  className="bg-void-light text-text"
                >
                  {model.displayName || model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* Custom dropdown icon with provider color */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <span className={providerColors[selectedProvider]}>
            {providerIcons[selectedProvider]}
          </span>
        </div>
      </div>

      {/* Current model info */}
      <div className="flex items-center gap-2 px-1">
        <span className={`${providerColors[selectedProvider]}`}>
          {providerIcons[selectedProvider]}
        </span>
        <span className="text-xs text-text-muted truncate">
          {selectedModel}
        </span>
      </div>
    </div>
  );
}

export default ModelSelector;

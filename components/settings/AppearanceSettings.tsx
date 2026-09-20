import React, { useEffect, useId, useState } from 'react';
import {
  applyAppearancePreferences,
  APPEARANCE_THEMES,
  AppearancePreferences,
  AppearanceStorage,
  DEFAULT_APPEARANCE_PREFERENCES,
  loadAppearancePreferences,
  READING_FONT_SIZES,
  ReadingFontSize,
  saveAppearancePreferencesAsync,
} from '../../services/appearancePreferences';

export interface AppearanceSettingsProps {
  /** Optional controlled value for settings pages that already own preferences. */
  value?: AppearancePreferences;
  /** Called after a preference is changed, including a reset to defaults. */
  onChange?: (preferences: AppearancePreferences) => void;
  /** Optional initial value for tests or an embedding settings surface. */
  initialPreferences?: AppearancePreferences;
  /** Allows callers to provide a storage implementation without changing app behavior. */
  storage?: AppearanceStorage | null;
  className?: string;
}

const THEME_LABELS: Record<AppearancePreferences['theme'], { label: string; description: string }> =
  {
    system: { label: '跟隨系統', description: '依照裝置的明暗模式切換' },
    light: { label: '淺色', description: '適合明亮環境與紙張閱讀' },
    dark: { label: '深色', description: '降低暗處閱讀時的眩光' },
  };

const FONT_SIZE_LABELS: Record<ReadingFontSize, { label: string; description: string }> = {
  small: { label: '精簡', description: '較多內容同時顯示' },
  medium: { label: '標準', description: 'EduCare 預設閱讀大小' },
  large: { label: '放大', description: '適合長時間閱讀或放大顯示' },
};

const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  value,
  onChange,
  initialPreferences,
  storage,
  className,
}) => {
  const [localPreferences, setLocalPreferences] = useState<AppearancePreferences>(() =>
    initialPreferences
      ? { ...initialPreferences }
      : loadAppearancePreferences(storage === undefined ? undefined : storage),
  );
  const [statusMessage, setStatusMessage] = useState('');
  const headingId = useId();
  const descriptionId = useId();
  const isControlled = value !== undefined;
  const preferences = value ?? localPreferences;
  const { theme, fontSize, reducedMotion } = preferences;

  useEffect(() => {
    applyAppearancePreferences({ theme, fontSize, reducedMotion });
  }, [fontSize, reducedMotion, theme]);

  const updatePreferences = async (updates: Partial<AppearancePreferences>) => {
    const nextPreferences: AppearancePreferences = {
      ...preferences,
      ...updates,
    };

    if (!isControlled) {
      setLocalPreferences(nextPreferences);
    }

    applyAppearancePreferences(nextPreferences);
    onChange?.(nextPreferences);

    try {
      const persisted = await saveAppearancePreferencesAsync(
        nextPreferences,
        storage === undefined ? undefined : storage,
      );
      setStatusMessage(persisted ? '外觀設定已儲存。' : '外觀設定已套用，但瀏覽器未允許保存偏好。');
    } catch {
      setStatusMessage('外觀設定已套用，但瀏覽器未允許保存偏好。');
    }
  };

  const handleThemeChange = (theme: AppearancePreferences['theme']) => {
    void updatePreferences({ theme });
  };

  const handleFontSizeChange = (fontSize: ReadingFontSize) => {
    void updatePreferences({ fontSize });
  };

  const handleReset = () => {
    void updatePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES });
  };

  return (
    <section
      className={`appearance-settings${className ? ` ${className}` : ''}`}
      data-testid='appearance-settings'
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <div className='appearance-settings__header'>
        <div>
          <p className='appearance-settings__eyebrow'>閱讀偏好</p>
          <h2 id={headingId} className='appearance-settings__title'>
            外觀與閱讀
          </h2>
          <p id={descriptionId} className='appearance-settings__description'>
            調整工作介面的色彩、閱讀大小與動態效果。偏好只保存在這台裝置上。
          </p>
        </div>
        <span className='appearance-settings__mark' aria-hidden='true'>
          Aa
        </span>
      </div>

      <fieldset className='appearance-settings__group'>
        <legend className='appearance-settings__legend'>色彩主題</legend>
        <div className='appearance-settings__options appearance-settings__options--themes'>
          {APPEARANCE_THEMES.map(theme => {
            const option = THEME_LABELS[theme];
            return (
              <label
                key={theme}
                className={`appearance-settings__option ${
                  preferences.theme === theme ? 'appearance-settings__option--selected' : ''
                }`}
              >
                <input
                  type='radio'
                  name='appearance-theme'
                  value={theme}
                  checked={preferences.theme === theme}
                  onChange={() => handleThemeChange(theme)}
                  data-testid={`appearance-theme-${theme}`}
                />
                <span className='appearance-settings__option-copy'>
                  <span className='appearance-settings__option-label'>{option.label}</span>
                  <span className='appearance-settings__option-description'>
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className='appearance-settings__group'>
        <label className='appearance-settings__field' htmlFor='appearance-font-size'>
          <span>
            <span className='appearance-settings__legend'>閱讀字級</span>
            <span className='appearance-settings__field-description'>
              只調整對話與教材內容，不會改變作品預覽的版面。
            </span>
          </span>
          <select
            id='appearance-font-size'
            value={preferences.fontSize}
            onChange={event => handleFontSizeChange(event.target.value as ReadingFontSize)}
            className='appearance-settings__select'
            data-testid='appearance-font-size'
          >
            {READING_FONT_SIZES.map(fontSize => (
              <option key={fontSize} value={fontSize}>
                {FONT_SIZE_LABELS[fontSize].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className='appearance-settings__group appearance-settings__motion'>
        <label className='appearance-settings__check' htmlFor='appearance-reduced-motion'>
          <input
            id='appearance-reduced-motion'
            type='checkbox'
            checked={preferences.reducedMotion}
            onChange={event => void updatePreferences({ reducedMotion: event.target.checked })}
            data-testid='appearance-reduced-motion'
          />
          <span className='appearance-settings__option-copy'>
            <span className='appearance-settings__option-label'>減少動態效果</span>
            <span className='appearance-settings__option-description'>
              停用大部分轉場與動畫，保留必要的狀態變化。
            </span>
          </span>
        </label>
      </div>

      <div className='appearance-settings__footer'>
        <p className='appearance-settings__status' role='status' aria-live='polite'>
          {statusMessage}
        </p>
        <button type='button' className='appearance-settings__reset' onClick={handleReset}>
          恢復預設
        </button>
      </div>
    </section>
  );
};

export { AppearanceSettings };
export default AppearanceSettings;

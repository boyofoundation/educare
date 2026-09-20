import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Assistant } from '../../types';

interface CustomSelectProps {
  assistants: Assistant[];
  selectedAssistant: Assistant | null;
  onSelect: (assistantId: string) => void;
  placeholder?: string;
  className?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  assistants,
  selectedAssistant,
  onSelect,
  placeholder = '請選擇一個助理',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredAssistants = assistants.filter(
    assistant =>
      assistant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      assistant.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev < filteredAssistants.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredAssistants[highlightedIndex]) {
          handleSelect(filteredAssistants[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleSelect = (assistant: Assistant) => {
    onSelect(assistant.id);
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={dropdownRef} className={`custom-select relative ${className}`}>
      {/* Selected Value Display */}
      <button
        type='button'
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
        className='custom-select__trigger w-full p-2.5 bg-gray-700/50 border rounded-lg text-white text-sm focus:ring-cyan-500 focus:border-cyan-500 transition-colors hover:bg-gray-600/50 cursor-pointer flex items-center justify-between appearance-none'
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        aria-label={selectedAssistant ? `已選擇: ${selectedAssistant.name}` : placeholder}
      >
        <div className='flex items-center min-w-0 flex-1'>
          {selectedAssistant ? (
            <>
              <div className='custom-select__avatar w-6 h-6 rounded bg-cyan-500 flex items-center justify-center mr-2 flex-shrink-0'>
                <span className='text-white font-medium text-xs'>
                  {selectedAssistant.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className='truncate'>{selectedAssistant.name}</span>
            </>
          ) : (
            <span className='custom-select__placeholder text-gray-400'>{placeholder}</span>
          )}
        </div>

        <svg
          className={`custom-select__chevron w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className='custom-select__menu absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600/50 rounded-lg shadow-lg max-h-64 overflow-hidden'>
          {/* Search Input */}
          {assistants.length > 5 && (
            <div className='custom-select__search-wrap p-2 border-b border-gray-700/50'>
              <input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(-1);
                }}
                onKeyDown={handleKeyDown}
                placeholder='搜索助理...'
                className='custom-select__search w-full px-3 py-1.5 bg-gray-700/50 border border-gray-600/30 rounded text-white text-sm placeholder-gray-400 focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500'
              />
            </div>
          )}

          {/* Options List */}
          <div className='custom-select__options max-h-48 overflow-y-auto py-1' role='listbox'>
            {filteredAssistants.length === 0 ? (
              <div className='custom-select__empty px-3 py-2 text-gray-400 text-sm text-center'>
                {searchQuery ? `找不到 "${searchQuery}"` : '沒有助理'}
              </div>
            ) : (
              filteredAssistants.map((assistant, index) => (
                <button
                  key={assistant.id}
                  type='button'
                  onClick={() => handleSelect(assistant)}
                  className={`custom-select__option w-full px-3 py-2.5 text-left flex items-center hover:bg-gray-700/50 ${
                    highlightedIndex === index
                      ? 'custom-select__option--highlighted bg-gray-700/50'
                      : ''
                  } ${selectedAssistant?.id === assistant.id ? 'custom-select__option--selected bg-cyan-600/20' : ''}`}
                  role='option'
                  aria-selected={selectedAssistant?.id === assistant.id}
                >
                  <div className='custom-select__avatar w-6 h-6 rounded bg-cyan-500 flex items-center justify-center mr-2 flex-shrink-0'>
                    <span className='text-white font-medium text-xs'>
                      {assistant.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='custom-select__option-title text-white truncate'>
                      {assistant.name}
                    </div>
                    <div className='custom-select__option-meta text-xs text-gray-400'>
                      建立於 {new Date(assistant.createdAt).toLocaleDateString('zh-TW')}
                    </div>
                  </div>
                  {selectedAssistant?.id === assistant.id && (
                    <svg
                      className='w-4 h-4 text-cyan-500 ml-2 flex-shrink-0'
                      fill='currentColor'
                      viewBox='0 0 20 20'
                    >
                      <path
                        fillRule='evenodd'
                        d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
                        clipRule='evenodd'
                      />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomSelect;

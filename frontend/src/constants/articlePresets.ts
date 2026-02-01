export type CategoryPreset = {
  key: 'helm' | 'handschuhe' | 'jacke' | 'hose' | 'koppel';
  label: string;
  sizeOptions?: string[];
  allowCustomSize?: boolean;
  defaultSize?: string;
};

export const CUSTOM_CATEGORY_KEY = '__custom';

const KOPPEL_SIZES = Array.from({ length: 9 }, (_, index) => String(80 + index * 5));

export const CATEGORY_PRESETS: CategoryPreset[] = [
  {
    key: 'helm',
    label: 'Helm',
    sizeOptions: ['Einheitsgröße'],
    defaultSize: 'Einheitsgröße'
  },
  {
    key: 'handschuhe',
    label: 'Handschuhe',
    sizeOptions: ['8', '9', '10', '11']
  },
  {
    key: 'jacke',
    label: 'Jacke'
  },
  {
    key: 'hose',
    label: 'Hose'
  },
  {
    key: 'koppel',
    label: 'Koppel',
    sizeOptions: KOPPEL_SIZES,
    allowCustomSize: true
  }
];

export function findPresetByKey(key?: string | null): CategoryPreset | undefined {
  if (!key) {
    return undefined;
  }
  return CATEGORY_PRESETS.find((preset) => preset.key === key);
}

export function matchPresetByCategory(category: string): CategoryPreset | undefined {
  const normalized = category.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return CATEGORY_PRESETS.find((preset) => preset.label.toLowerCase() === normalized);
}

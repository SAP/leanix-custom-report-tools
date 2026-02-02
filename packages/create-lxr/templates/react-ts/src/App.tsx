/**
 * Demo LeanIX Custom Report
 *
 * This demonstrates a basic LeanIX custom report that visualizes fact sheet lifecycle data.
 * Feel free to customize this example or start from scratch with your own implementation.
 *
 * Some ideas to customize this report:
 * - Change FACT_SHEET_TYPE (e.g., 'Project', 'ITComponent')
 *   or remove fixedFactSheetType to query all fact sheet types
 * - Modify the attributes array to fetch different fields
 * - Update the visualization components to display your data as needed
 *
 * Replace or remove this comment block once you've customized your report
 */

import type { lxr } from '@leanix/reporting';
import { lx } from '@leanix/reporting';
import { useEffect, useMemo, useState } from 'react';
import { BarChart } from './BarChart';
import './App.css';

const FACT_SHEET_TYPE = 'Application';
const FIELD_NAME = 'lifecycle';

interface LifecycleConfig {
  order: string[]
  colors: Record<string, string>
  labels: Record<string, string>
}

function App() {
  const [factSheets, setFactSheets] = useState<lxr.FactSheet[]>([]);
  const [lifecycleConfig, setLifecycleConfig] = useState<LifecycleConfig>({
    order: [],
    colors: {},
    labels: {},
  });

  useEffect(() => {
    const initReport = async () => {
      const setup = await lx.init();
      const settings = setup.settings;

      const config: LifecycleConfig = {
        order: [],
        colors: { 'n/a': '#CCCCCC' },
        labels: { 'n/a': 'n/a' },
      };

      const lifecycleField
        = settings.dataModel.factSheets[FACT_SHEET_TYPE]?.fields?.[FIELD_NAME];
      if (lifecycleField && 'values' in lifecycleField) {
        config.order = lifecycleField.values as string[];
      }

      const metadata = lx.getFactSheetFieldMetaData(
        FACT_SHEET_TYPE,
        FIELD_NAME,
      );
      if (metadata && 'values' in metadata) {
        for (const [key, value] of Object.entries(metadata.values)) {
          config.colors[key] = value.bgColor || '#4A90E2';
          config.labels[key] = lx.translateFieldValue(
            FACT_SHEET_TYPE,
            FIELD_NAME,
            key,
          );
        }
      }

      setLifecycleConfig(config);

      lx.ready({
        facets: [
          {
            key: 'main',
            fixedFactSheetType: FACT_SHEET_TYPE,
            attributes: ['id', 'displayName', `${FIELD_NAME} { asString }`],
            callback: (data) => {
              setFactSheets(data || []);
            },
          },
        ],
      });
    };

    initReport();
  }, []);

  const lifecycleCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const factSheet of factSheets) {
      const rawKey = factSheet[FIELD_NAME]?.asString;
      const key = (!rawKey || rawKey === '-') ? 'n/a' : rawKey;
      counts[key] = (counts[key] || 0) + 1;
    }

    return counts;
  }, [factSheets]);

  const chartData = useMemo(() => {
    const orderedKeys = [...lifecycleConfig.order, 'n/a'];

    return {
      labels: orderedKeys.map(key => lifecycleConfig.labels[key] || key),
      values: orderedKeys.map(key => lifecycleCounts[key] || 0),
      colors: orderedKeys.map(
        key => lifecycleConfig.colors[key] || '#4A90E2',
      ),
    };
  }, [lifecycleCounts, lifecycleConfig]);

  return (
    <div className="app">
      <p>Total: {factSheets.length} fact sheets</p>
      <div className="chart-container">
        <BarChart data={chartData} />
      </div>
    </div>
  );
}

export default App;

/**
 * Demo LeanIX Custom Report
 *
 * This demonstrates a basic LeanIX custom report that visualizes Applications by Business Criticality.
 * The report displays a bar chart showing the distribution of applications across different criticality levels:
 * - Administrative Service
 * - Business Operational
 * - Business Critical
 * - Mission Critical
 *
 * Feel free to customize this example or start from scratch with your own implementation.
 */

import type { lxr } from '@leanix/reporting';
import { lx } from '@leanix/reporting';
import { useEffect, useMemo, useState } from 'react';
import { BarChart } from './BarChart';
import './App.css';

const FACT_SHEET_TYPE = 'Application';
const FIELD_NAME = 'businessCriticality';

interface ApplicationData extends lxr.FactSheet {
  businessCriticality?: string;
}

interface CriticalityConfig {
  order: string[];
  colors: Record<string, string>;
  labels: Record<string, string>;
}

function App() {
  const [applications, setApplications] = useState<ApplicationData[]>([]);
  const [criticalityConfig, setCriticalityConfig] = useState<CriticalityConfig>({
    order: [],
    colors: {},
    labels: {}
  });

  useEffect(() => {
    const initReport = async () => {
      const setup = await lx.init();
      const settings = setup.settings;

      // Get business criticality configuration from data model
      const config: CriticalityConfig = {
        order: [],
        colors: {},
        labels: {}
      };

      const criticalityField = settings.dataModel.factSheets[FACT_SHEET_TYPE]?.fields?.[FIELD_NAME];
      if (criticalityField && 'values' in criticalityField) {
        config.order = criticalityField.values as string[];
      }

      const metadata = lx.getFactSheetFieldMetaData(FACT_SHEET_TYPE, FIELD_NAME);
      if (metadata && 'values' in metadata) {
        for (const [key, value] of Object.entries(metadata.values)) {
          config.colors[key] = value.bgColor || '#ffffff';
          config.labels[key] = lx.translateFieldValue(FACT_SHEET_TYPE, FIELD_NAME, key);
        }
      }

      setCriticalityConfig(config);

      lx.ready({
        facets: [
          {
            key: 'main',
            fixedFactSheetType: FACT_SHEET_TYPE,
            attributes: ['id', 'displayName', FIELD_NAME],
            callback: (data) => {
              setApplications((data || []) as ApplicationData[]);
            }
          }
        ]
      });
    };

    initReport();
  }, []);

  const criticalityCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const app of applications) {
      const criticality = app.businessCriticality;
      // Use business criticality value, or 'n/a' if not set
      const key = criticality || 'n/a';
      counts[key] = (counts[key] || 0) + 1;
    }

    return counts;
  }, [applications]);

  const chartData = useMemo(() => {
    // Include all configured criticality levels plus any found in data that aren't configured
    const configuredLevels = criticalityConfig.order;
    const foundLevels = Object.keys(criticalityCounts);
    const allLevels = [...new Set([...configuredLevels, ...foundLevels])];

    // Filter to only show levels that have data
    const levelsWithData = allLevels.filter((level) => (criticalityCounts[level] || 0) > 0);

    return {
      labels: levelsWithData.map((level) => criticalityConfig.labels[level] || level),
      values: levelsWithData.map((level) => criticalityCounts[level] || 0),
      colors: levelsWithData.map((level) => criticalityConfig.colors[level] || '#ffffff')
    };
  }, [criticalityCounts, criticalityConfig]);

  return (
    <div className="app">
      <div className="chart-container">
        <BarChart data={chartData} />
      </div>
    </div>
  );
}

export default App;

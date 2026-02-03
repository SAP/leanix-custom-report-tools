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

interface ApplicationData extends lxr.FactSheet {
  lifecycle?: {
    phases?: Array<{
      phase?: string;
    }>;
  };
}

interface PhaseConfig {
  order: string[];
  colors: Record<string, string>;
  labels: Record<string, string>;
}

function App() {
  const [applications, setApplications] = useState<ApplicationData[]>([]);
  const [phaseConfig, setPhaseConfig] = useState<PhaseConfig>({
    order: [],
    colors: {},
    labels: {}
  });

  useEffect(() => {
    const initReport = async () => {
      const setup = await lx.init();
      const settings = setup.settings;

      // Get lifecycle phase configuration from data model
      const config: PhaseConfig = {
        order: [],
        colors: {},
        labels: {}
      };

      const lifecycleField = settings.dataModel.factSheets[FACT_SHEET_TYPE]?.fields?.[FIELD_NAME];
      if (lifecycleField && 'values' in lifecycleField) {
        config.order = lifecycleField.values as string[];
      }

      const metadata = lx.getFactSheetFieldMetaData(FACT_SHEET_TYPE, FIELD_NAME);
      if (metadata && 'values' in metadata) {
        for (const [key, value] of Object.entries(metadata.values)) {
          config.colors[key] = value.bgColor || '#ffffff';
          config.labels[key] = lx.translateFieldValue(FACT_SHEET_TYPE, FIELD_NAME, key);
        }
      }

      setPhaseConfig(config);

      lx.ready({
        facets: [
          {
            key: 'main',
            fixedFactSheetType: FACT_SHEET_TYPE,
            attributes: ['id', 'displayName', `${FIELD_NAME} { phases { phase } }`],
            callback: (data) => {
              setApplications((data || []) as ApplicationData[]);
            }
          }
        ]
      });
    };

    initReport();
  }, []);

  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const app of applications) {
      const phases = app.lifecycle?.phases;
      if (phases && phases.length > 0) {
        // Count each unique phase
        const uniquePhases = new Set(phases.map((p) => p.phase).filter(Boolean));
        for (const phase of uniquePhases) {
          counts[phase!] = (counts[phase!] || 0) + 1;
        }
      } else {
        // No lifecycle data
        counts['n/a'] = (counts['n/a'] || 0) + 1;
      }
    }

    return counts;
  }, [applications]);

  const chartData = useMemo(() => {
    // Include all configured phases plus any found in data that aren't configured
    const configuredPhases = phaseConfig.order;
    const foundPhases = Object.keys(phaseCounts);
    const allPhases = [...new Set([...configuredPhases, ...foundPhases])];

    // Filter to only show phases that have data
    const phasesWithData = allPhases.filter((phase) => (phaseCounts[phase] || 0) > 0);

    return {
      labels: phasesWithData.map((phase) => phaseConfig.labels[phase] || phase),
      values: phasesWithData.map((phase) => phaseCounts[phase] || 0),
      colors: phasesWithData.map((phase) => phaseConfig.colors[phase] || '#ffffff')
    };
  }, [phaseCounts, phaseConfig]);

  return (
    <div className="app">
      <div className="chart-container">
        <BarChart data={chartData} />
      </div>
    </div>
  );
}

export default App;

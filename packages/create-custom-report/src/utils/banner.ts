import { blue } from 'kolorist';
import pkg from '../../package.json' assert { type: 'json' };

const banner = blue(
  `SAP LeanIX Custom Report Scaffolding Tool v${pkg.version}`
);

export default banner;

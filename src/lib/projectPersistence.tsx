import { createContext } from 'react';
import { saveProject } from './project';

// The classic studio and V2 intentionally write to different browser stores.
export const ProjectPersistence = createContext(saveProject);

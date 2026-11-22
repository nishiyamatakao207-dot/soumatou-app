import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { migrateLegacyMedia, requestPersistentStorage } from './data/repository';
import './styles.css';

requestPersistentStorage();

// 以前の版で保存したデータを新しい保存形式に移してから画面を出す
migrateLegacyMedia()
  .catch(() => {})
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

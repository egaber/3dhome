import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ShowroomApp from './ShowroomApp';
import './styles.css';

function Application() {
  const [showroom, setShowroom] = useState(location.hash === '#v2');
  useEffect(() => {
    const navigate = () => setShowroom(location.hash === '#v2');
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  return showroom ? <ShowroomApp /> : <App />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Application /></StrictMode>);
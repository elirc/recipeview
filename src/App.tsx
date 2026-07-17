import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { SearchBar } from './components/SearchBar';
import { HomePage } from './pages/HomePage';
import { DishPage } from './pages/DishPage';
import { RecipePage } from './pages/RecipePage';
import { useEffect, useState } from 'react';

export default function App() {
  return (
    <div className="app">
      <TopBar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dish/:id" element={<DishPage />} />
        <Route path="/recipe/:id" element={<RecipePage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </div>
  );
}

function TopBar() {
  const nav = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark' | null>(
    () => (localStorage.getItem('rl-theme') as 'light' | 'dark') ?? null,
  );

  // Explicit theme override wins over the OS preference when set.
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  return (
    <header className="topbar">
      <Link to="/" className="brand" title="Recipe Lab — home">
        <span className="flask">🧪</span>
        <span>Recipe Lab</span>
      </Link>
      <SearchBar />
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn icon ghost"
          title="Toggle theme"
          aria-label="Toggle light/dark theme"
          onClick={() => {
            const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            const next = cur === 'dark' ? 'light' : 'dark';
            setTheme(next);
            localStorage.setItem('rl-theme', next);
          }}
        >
          <span className="theme-icon">◐</span>
        </button>
        <button className="btn primary" onClick={() => nav('/?new=1')}>
          <span style={{ fontSize: 16, lineHeight: 0 }}>+</span> New dish
        </button>
      </div>
    </header>
  );
}

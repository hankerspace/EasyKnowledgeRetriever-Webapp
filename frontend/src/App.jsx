import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import QueryPage from './pages/QueryPage';
import GraphPage from './pages/GraphPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/search" replace />} />
          <Route path="search" element={<QueryPage />} />
          <Route path="graph" element={<GraphPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;

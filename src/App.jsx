import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import './App.css';

const IDENTIFIER_KEYS = ['part number', 'part', 'sku', 'pn', 'component', 'item', 'id', 'mpn', 'manufacturer part number'];

const MANUFACTURER_FIELDS = ['manufacturer', 'brand', 'maker', 'vendor'];
const FAMILY_FIELDS = ['family', 'series', 'product family', 'product'];

function sanitizeRecords(records) {
  return records
    .map((record) => {
      const sanitized = {};
      Object.entries(record).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        const trimmed = String(value).trim();
        if (!trimmed) return;
        sanitized[key.trim()] = trimmed;
      });
      return sanitized;
    })
    .filter((record) => Object.keys(record).length > 0);
}

function extractIdentifier(record) {
  if (!record) return '';
  const lowerMap = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value])
  );

  for (const candidate of IDENTIFIER_KEYS) {
    if (lowerMap[candidate]) {
      return lowerMap[candidate].toUpperCase();
    }
  }

  const firstValue = Object.values(record)[0];
  return firstValue ? String(firstValue).toUpperCase() : '';
}

function getFieldValue(record, fieldNames) {
  if (!record) return '';
  const entries = Object.entries(record);
  for (const field of fieldNames) {
    const lowerField = field.toLowerCase();
    for (const [key, value] of entries) {
      if (key.toLowerCase() === lowerField && value !== undefined && value !== null) {
        const trimmed = String(value).trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
  }
  return '';
}

async function parseFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(sanitizeRecords(results.data)),
        error: (error) => reject(error),
      });
    });
  }

  if (['xls', 'xlsx'].includes(extension)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false });
          resolve(sanitizeRecords(jsonData));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Unable to read file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error('Unsupported file format. Upload CSV or Excel.');
}

const defaultAgentSteps = [
  {
    title: 'Understand requirements',
    description:
      'Use the uploaded request list to identify the number of unique components, quantities, and any missing specifications that could impact sourcing.',
  },
  {
    title: 'Cross-check catalog',
    description:
      'Compare each requested connector with the active catalog. Flag legacy or end-of-life parts and highlight viable alternates.',
  },
  {
    title: 'Compose proposal brief',
    description:
      'Summarize available inventory, lead times, and cost-saving bundles. Recommend follow-up actions for uncovered parts.',
  },
];

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function App() {
  const [catalogFiles, setCatalogFiles] = useState([]);
  const [expandedCatalog, setExpandedCatalog] = useState(null);
  const [activeCatalogId, setActiveCatalogId] = useState(null);
  const [clientRecords, setClientRecords] = useState([]);
  const [aiBrief, setAiBrief] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [agentSteps, setAgentSteps] = useState(defaultAgentSteps);
  const [matchSearch, setMatchSearch] = useState('');

  const catalogUploadRef = useRef(null);
  const updateUploadRef = useRef({});
  const clientUploadRef = useRef(null);

  const activeCatalog = useMemo(
    () => catalogFiles.find((file) => file.id === activeCatalogId) || null,
    [catalogFiles, activeCatalogId]
  );

  const matchResult = useMemo(() => {
    if (!activeCatalog || clientRecords.length === 0) {
      return {
        found: [],
        missing: [],
      };
    }

    const catalogIndex = new Map();
    activeCatalog.records.forEach((record) => {
      const identifier = extractIdentifier(record);
      if (identifier) {
        catalogIndex.set(identifier, record);
      }
    });

    const found = [];
    const missing = [];

    clientRecords.forEach((record) => {
      const identifier = extractIdentifier(record);
      if (!identifier) {
        missing.push({ record, reason: 'No identifier detected' });
        return;
      }

      if (catalogIndex.has(identifier)) {
        found.push({
          requested: record,
          catalog: catalogIndex.get(identifier),
        });
      } else {
        missing.push({ record, reason: 'Not present in catalog' });
      }
    });

    return { found, missing };
  }, [activeCatalog, clientRecords]);

  const matchStats = useMemo(() => {
    const total = clientRecords.length;
    const found = matchResult.found.length;
    const missing = matchResult.missing.length;
    const coverage = total ? Math.round((found / total) * 100) : 0;
    return { total, found, missing, coverage };
  }, [clientRecords.length, matchResult]);

  const requestInsights = useMemo(() => {
    if (!clientRecords.length) {
      return {
        uniqueCount: 0,
        duplicateCount: 0,
        unidentifiedCount: 0,
        duplicates: [],
      };
    }

    const identifierCounts = new Map();
    const duplicateMap = new Map();
    let unidentifiedCount = 0;

    clientRecords.forEach((record, index) => {
      const identifier = extractIdentifier(record);
      const key = identifier || `row-${index}`;
      if (!identifier) {
        unidentifiedCount += 1;
      }
      const current = identifierCounts.get(key) ?? 0;
      identifierCounts.set(key, current + 1);
      if (current >= 1) {
        duplicateMap.set(key, {
          identifier: identifier || `Unidentified row ${index + 1}`,
          occurrences: current + 1,
        });
      }
    });

    const duplicates = Array.from(duplicateMap.values()).sort((a, b) => b.occurrences - a.occurrences);

    return {
      uniqueCount: identifierCounts.size,
      duplicateCount: clientRecords.length - identifierCounts.size,
      unidentifiedCount,
      duplicates,
    };
  }, [clientRecords]);

  const topManufacturers = useMemo(() => {
    if (!matchResult.found.length) return [];
    const counts = new Map();
    matchResult.found.forEach(({ catalog }) => {
      const manufacturer = getFieldValue(catalog, MANUFACTURER_FIELDS) || 'Unspecified manufacturer';
      counts.set(manufacturer, (counts.get(manufacturer) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / matchResult.found.length) * 100),
      }));
  }, [matchResult.found]);

  const topFamilies = useMemo(() => {
    if (!matchResult.found.length) return [];
    const counts = new Map();
    matchResult.found.forEach(({ catalog }) => {
      const family = getFieldValue(catalog, FAMILY_FIELDS) || 'General catalog';
      counts.set(family, (counts.get(family) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / matchResult.found.length) * 100),
      }));
  }, [matchResult.found]);

  const filteredMatches = useMemo(() => {
    const query = matchSearch.trim().toLowerCase();
    if (!query) return matchResult.found;
    return matchResult.found.filter((item) => {
      const identifier = extractIdentifier(item.requested).toLowerCase();
      const catalogValues = Object.values(item.catalog)
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).toLowerCase());
      if (identifier.includes(query)) return true;
      return catalogValues.some((value) => value.includes(query));
    });
  }, [matchResult.found, matchSearch]);

  const handleCatalogUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const uploads = await Promise.all(
      files.map(async (file) => {
        const records = await parseFile(file);
        return {
          id: crypto.randomUUID(),
          name: file.name,
          records,
          uploadedAt: new Date(),
        };
      })
    );

    setCatalogFiles((prev) => [...uploads, ...prev]);
    if (!activeCatalogId && uploads.length > 0) {
      setActiveCatalogId(uploads[0].id);
    }

    if (catalogUploadRef.current) {
      catalogUploadRef.current.value = '';
    }
  };

  const handleCatalogReplace = async (file, catalogId) => {
    const records = await parseFile(file);
    setCatalogFiles((prev) =>
      prev.map((entry) =>
        entry.id === catalogId
          ? { ...entry, name: file.name, records, uploadedAt: new Date() }
          : entry
      )
    );
  };

  const handleClientUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const combinedRecords = [];

    for (const file of files) {
      const records = await parseFile(file);
      combinedRecords.push(...records);
    }

    setClientRecords(combinedRecords);
    if (clientUploadRef.current) {
      clientUploadRef.current.value = '';
    }
  };

  const downloadReport = () => {
    const header = ['Requested Part', 'Status', 'Catalog Match'];
    const rows = clientRecords.map((record) => {
      const identifier = extractIdentifier(record);
      const foundEntry = matchResult.found.find(
        (item) => extractIdentifier(item.requested) === identifier
      );
      const status = foundEntry ? 'Available' : 'Missing';
      const match = foundEntry ? JSON.stringify(foundEntry.catalog) : '';
      return [identifier, status, match];
    });

    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell ?? ''}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'product-search-report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const runAiBrief = async () => {
    setAiError('');
    setAiLoading(true);

    if (!activeCatalog) {
      setAiError('Select an active catalog before requesting an AI brief.');
      setAiLoading(false);
      return;
    }

    if (!clientRecords.length) {
      setAiError('Upload a client component list before requesting an AI brief.');
      setAiLoading(false);
      return;
    }

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      setAiError('Set VITE_OPENAI_API_KEY in your environment to enable AI analysis.');
      setAiLoading(false);
      return;
    }

    const systemPrompt = `You are an AI sourcing specialist for an electronics connector manufacturer. \n` +
      `Combine catalog intelligence with the requested part list to produce a short, actionable brief. \n` +
      `Highlight coverage percentage, list top available matches with advantages, and recommend next actions for missing parts.`;

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          reasoning: { effort: 'medium' },
          input: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: `Catalog sample: ${JSON.stringify(activeCatalog.records.slice(0, 10))}. \n` +
                `Client request sample: ${JSON.stringify(clientRecords.slice(0, 10))}. \n` +
                `Coverage: ${matchStats.coverage}% with ${matchStats.found} of ${matchStats.total} components matched. \n` +
                `Missing identifiers: ${matchResult.missing
                  .slice(0, 10)
                  .map((item) => extractIdentifier(item.record) || 'Unidentified')
                  .join(', ')}`,
            },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate AI brief.');
      }

      let textOutput = data.output_text;
      if (!textOutput) {
        const messageContent = data.choices?.[0]?.message?.content;
        if (Array.isArray(messageContent)) {
          textOutput = messageContent
            .map((chunk) =>
              typeof chunk === 'string' ? chunk : chunk.text ?? ''
            )
            .join('');
        } else if (typeof messageContent === 'string') {
          textOutput = messageContent;
        }
      }

      setAiBrief(textOutput || 'No AI response generated.');
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAgentStepEdit = (index, field, value) => {
    setAgentSteps((prev) =>
      prev.map((step, idx) => (idx === index ? { ...step, [field]: value } : step))
    );
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero__badge">AI Product Search</div>
        <h1>
          AI-Powered Product Search<br />
          for Accurate Connector Proposals
        </h1>
        <p>
          Upload client demand lists, sync the latest catalog intelligence, and let the
          AI sourcing agent craft actionable proposals in minutes.
        </p>
        <div className="hero__highlights">
          <div className="highlight-card">
            <span className="highlight-card__label">Key Result</span>
            <strong>95% search time eliminated</strong>
          </div>
          <div className="highlight-card">
            <span className="highlight-card__label">AI Insight</span>
            <strong>Instant bill-of-material scans</strong>
          </div>
          <div className="highlight-card">
            <span className="highlight-card__label">Smart Response</span>
            <strong>Guided proposals & alternates</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panel__header">
            <h2>Catalog Management</h2>
            <p>Upload the latest product catalog spreadsheets and keep every revision in sync.</p>
          </div>
          <div className="panel__actions">
            <button className="button" onClick={() => catalogUploadRef.current?.click()}>
              Upload catalog files
            </button>
            <input
              ref={catalogUploadRef}
              type="file"
              accept=".csv,.xls,.xlsx"
              multiple
              hidden
              onChange={handleCatalogUpload}
            />
          </div>
          <div className="catalog-list">
            {catalogFiles.length === 0 && (
              <div className="empty-state">
                <h3>No catalogs uploaded</h3>
                <p>Drop in your master connector database to begin matching requests.</p>
              </div>
            )}
            {catalogFiles.map((file) => {
              const isActive = file.id === activeCatalogId;
              const isExpanded = expandedCatalog === file.id;
              return (
                <article key={file.id} className={`catalog-card ${isActive ? 'catalog-card--active' : ''}`}>
                  <header className="catalog-card__header">
                    <div>
                      <h3>{file.name}</h3>
                      <p>{file.records.length} parts • Updated {formatDate(file.uploadedAt)}</p>
                    </div>
                    <div className="catalog-card__actions">
                      <button className="button button--ghost" onClick={() => setExpandedCatalog(isExpanded ? null : file.id)}>
                        {isExpanded ? 'Hide' : 'Check'}
                      </button>
                      <button className="button button--ghost" onClick={() => setActiveCatalogId(file.id)}>
                        {isActive ? 'Active' : 'Activate'}
                      </button>
                      <button
                        className="button button--ghost"
                        onClick={() => updateUploadRef.current[file.id]?.click()}
                      >
                        Update
                      </button>
                      <input
                        ref={(el) => {
                          updateUploadRef.current[file.id] = el;
                        }}
                        type="file"
                        accept=".csv,.xls,.xlsx"
                        hidden
                        onChange={(event) => {
                          const replacement = event.target.files?.[0];
                          if (replacement) {
                            handleCatalogReplace(replacement, file.id);
                            event.target.value = '';
                          }
                        }}
                      />
                      <button
                        className="button button--ghost button--danger"
                        onClick={() => {
                          setCatalogFiles((prev) => prev.filter((entry) => entry.id !== file.id));
                          if (activeCatalogId === file.id) {
                            setActiveCatalogId(null);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </header>
                  {isExpanded && (
                    <div className="catalog-card__body">
                      <div className="catalog-card__grid">
                        {file.records.slice(0, 5).map((record, index) => (
                          <div key={index} className="catalog-record">
                            {Object.entries(record).map(([key, value]) => (
                              <div key={key}>
                                <span>{key}</span>
                                <strong>{value}</strong>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <p className="catalog-card__hint">
                        Showing a sample of {Math.min(file.records.length, 5)} of {file.records.length} records.
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Client Request Intake</h2>
            <p>Import the bill of materials or requested connector list from customers.</p>
          </div>
          <div className="panel__actions">
            <button className="button" onClick={() => clientUploadRef.current?.click()}>
              Upload request list
            </button>
            <input
              ref={clientUploadRef}
              type="file"
              accept=".csv,.xls,.xlsx"
              multiple
              hidden
              onChange={handleClientUpload}
            />
            <button className="button button--secondary" onClick={downloadReport} disabled={!clientRecords.length}>
              Download matched report
            </button>
          </div>
          <div className="stats-cards">
            <div className="stats-card">
              <span>Total components</span>
              <strong>{matchStats.total}</strong>
            </div>
            <div className="stats-card">
              <span>Matched</span>
              <strong>{matchStats.found}</strong>
            </div>
            <div className="stats-card">
              <span>Missing</span>
              <strong>{matchStats.missing}</strong>
            </div>
            <div className="stats-card">
              <span>Coverage</span>
              <strong>{matchStats.coverage}%</strong>
              <div className="coverage-bar">
                <div className="coverage-bar__fill" style={{ width: `${matchStats.coverage}%` }} />
              </div>
            </div>
          </div>
          <div className="insight-grid">
            <div className="insight-card">
              <h3>Request health</h3>
              <ul className="insight-list">
                <li>
                  <strong>{requestInsights.uniqueCount}</strong>
                  <span>Unique identifiers</span>
                </li>
                <li>
                  <strong>{requestInsights.duplicateCount}</strong>
                  <span>Duplicates detected</span>
                </li>
                <li>
                  <strong>{requestInsights.unidentifiedCount}</strong>
                  <span>Missing identifiers</span>
                </li>
              </ul>
              {requestInsights.duplicates.length > 0 && (
                <div className="insight-card__footer">
                  <span>Top duplicates</span>
                  <ul>
                    {requestInsights.duplicates.slice(0, 3).map((entry, index) => (
                      <li key={index}>
                        <strong>{entry.identifier}</strong>
                        <span>{entry.occurrences} requests</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="insight-card">
              <h3>Catalog matches</h3>
              {matchResult.found.length === 0 ? (
                <p className="empty-copy">Upload data to surface manufacturer and family insights.</p>
              ) : (
                <div className="insight-columns">
                  <div>
                    <span className="insight-label">Top manufacturers</span>
                    <ul>
                      {topManufacturers.map((entry, index) => (
                        <li key={index}>
                          <strong>{entry.name}</strong>
                          <span>{entry.count} matches • {entry.percentage}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="insight-label">Top product families</span>
                    <ul>
                      {topFamilies.map((entry, index) => (
                        <li key={index}>
                          <strong>{entry.name}</strong>
                          <span>{entry.count} matches • {entry.percentage}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="split-grid">
            <div className="panel-subcard">
              <h3>Available matches</h3>
              {matchResult.found.length === 0 ? (
                <p className="empty-copy">Matches will appear here once a catalog and request list are uploaded.</p>
              ) : (
                <ul className="match-list">
                  {matchResult.found.slice(0, 6).map((item, index) => (
                    <li key={index}>
                      <div>
                        <span>{extractIdentifier(item.requested)}</span>
                        <strong>{item.catalog.Description || item.catalog.description || 'Catalog match'}</strong>
                      </div>
                      <p>
                        {Object.entries(item.catalog)
                          .slice(0, 3)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' • ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel-subcard">
              <h3>Missing or alternate required</h3>
              {matchResult.missing.length === 0 ? (
                <p className="empty-copy">No gaps detected. Great job!</p>
              ) : (
                <ul className="missing-list">
                  {matchResult.missing.slice(0, 6).map((item, index) => (
                    <li key={index}>
                      <span>{extractIdentifier(item.record) || 'Unidentified part'}</span>
                      <p>{item.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Match Explorer</h2>
            <p>Filter the merged catalog intelligence to inspect the exact records backing each match.</p>
          </div>
          <div className="panel__actions panel__actions--row">
            <input
              type="search"
              value={matchSearch}
              onChange={(event) => setMatchSearch(event.target.value)}
              placeholder="Search matched parts, manufacturers, or specs"
            />
            <span className="panel__hint">
              Showing {filteredMatches.length} of {matchResult.found.length} matches
            </span>
          </div>
          <div className="match-table__wrapper">
            {matchResult.found.length === 0 ? (
              <div className="ai-placeholder">
                <h3>No matches available</h3>
                <p>Upload at least one catalog and client request list to explore a consolidated view.</p>
              </div>
            ) : (
              <div className="match-table__scroll">
                <table className="match-table">
                  <thead>
                    <tr>
                      <th>Requested identifier</th>
                      <th>Manufacturer</th>
                      <th>Family</th>
                      <th>Key specifications</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.slice(0, 20).map((item, index) => {
                      const manufacturer = getFieldValue(item.catalog, MANUFACTURER_FIELDS) || '—';
                      const family = getFieldValue(item.catalog, FAMILY_FIELDS) || '—';
                      const specificationPairs = Object.entries(item.catalog)
                        .filter(([key]) => !IDENTIFIER_KEYS.includes(key.toLowerCase()))
                        .slice(0, 3)
                        .map(([key, value]) => `${key}: ${value}`);
                      return (
                        <tr key={index}>
                          <td>{extractIdentifier(item.requested)}</td>
                          <td>{manufacturer}</td>
                          <td>{family}</td>
                          <td>{specificationPairs.join(' • ') || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredMatches.length > 20 && (
                  <p className="match-table__note">
                    Showing first 20 matches. Refine the search to focus on specific components.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="panel panel--ai">
          <div className="panel__header">
            <h2>Agent Playbook</h2>
            <p>Describe how the AI agent should navigate each proposal. Tailor the steps for your sourcing team.</p>
          </div>
          <div className="agent-steps">
            {agentSteps.map((step, index) => (
              <div key={index} className="agent-step">
                <div className="agent-step__index">{index + 1}</div>
                <div>
                  <input
                    value={step.title}
                    onChange={(event) => handleAgentStepEdit(index, 'title', event.target.value)}
                  />
                  <textarea
                    value={step.description}
                    onChange={(event) => handleAgentStepEdit(index, 'description', event.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel panel--ai">
          <div className="panel__header">
            <h2>AI Proposal Brief</h2>
            <p>Send the latest numbers to OpenAI and receive a tailored sales-ready narrative.</p>
          </div>
          <div className="panel__actions">
            <button className="button" onClick={runAiBrief} disabled={aiLoading}>
              {aiLoading ? 'Generating…' : 'Generate AI brief'}
            </button>
          </div>
          {aiError && <div className="alert alert--error">{aiError}</div>}
          {aiBrief ? (
            <article className="ai-brief">
              {aiBrief.split('\n').map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </article>
          ) : (
            <div className="ai-placeholder">
              <h3>Ready for instant proposals</h3>
              <p>
                Connect your OpenAI key and the agent will generate a detailed, client-friendly summary with
                coverage metrics, available alternates, and next-step recommendations.
              </p>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <div>
          <h3>Expected outcomes</h3>
          <ul>
            <li>95% search time eliminated across proposal teams</li>
            <li>2x faster delivery of client-ready quotations</li>
            <li>50% lower onboarding costs for new sales engineers</li>
          </ul>
        </div>
        <div>
          <h3>Deployment</h3>
          <p>
            Run <code>npm install</code> followed by <code>npm run dev</code> to start the Vite experience. Configure
            <code> VITE_OPENAI_API_KEY</code> to unlock the AI brief capability.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;

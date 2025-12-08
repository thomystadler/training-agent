import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, Heart, Calendar, MessageSquare, RefreshCw, AlertCircle, CheckCircle } from 'https://esm.sh/lucide-react@0.263.1';

// WICHTIG: Hier deine Werte eintragen!
const CONFIG = {
  WORKER_URL: 'https://intervals-icu-proxy.thomystadler.workers.dev',
  CLAUDE_PROJECT_ID: '019af852-ea99-76c1-80b9-92253bb0139a',
  ANTHROPIC_API_KEY: 'DEIN_ANTHROPIC_API_KEY', // Optional: Für direkte API-Calls
  DEFAULT_API_KEY: '3zemjjfaoba8649t72snopm65',
  DEFAULT_ATHLETE_ID: 'i177384'
};

export default function TrainingAgent() {
  const [apiKey, setApiKey] = useState(CONFIG.DEFAULT_API_KEY);
  const [athleteId, setAthleteId] = useState(CONFIG.DEFAULT_ATHLETE_ID);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [wellnessData, setWellnessData] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [athleteData, setAthleteData] = useState(null);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // API Helper
  const callAPI = async (endpoint) => {
    const url = `${CONFIG.WORKER_URL}/proxy${endpoint}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  };

  // Connect to Intervals.icu
  const connectToAPI = async () => {
    if (!apiKey) {
      setError('Bitte API-Key eingeben');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const athlete = await callAPI(`/api/v1/athlete/${athleteId}`);
      setAthleteData(athlete);
      
      const wellness = await callAPI(`/api/v1/athlete/${athleteId}/wellness?oldest=${weekAgo}&newest=${today}`);
      setWellnessData(Array.isArray(wellness) ? wellness : []);
      
      const activities = await callAPI(`/api/v1/athlete/${athleteId}/activities?oldest=${monthAgo}&newest=${today}`);
      setRecentActivities(Array.isArray(activities) ? activities : []);
      
      setIsConnected(true);
      
      // Load learnings from localStorage
      const learnings = JSON.parse(localStorage.getItem('agent_learnings') || '{}');
      
      setChatMessages([{
        role: 'assistant',
        content: `✅ Verbunden!\n\nAktuelle Form:\n• CTL: ${athlete.ctl?.toFixed(0) || 'N/A'}\n• ATL: ${athlete.atl?.toFixed(0) || 'N/A'}\n• TSB: ${athlete.yesterday_tsb?.toFixed(0) || 'N/A'}\n\nIch habe ${activities.length} Aktivitäten und frühere Learnings geladen. Was möchtest du wissen?`
      }]);
      
    } catch (err) {
      setError(`Verbindung fehlgeschlagen: ${err.message}`);
      console.error('Connection error:', err);
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // Calculate Recovery Score
  const calculateRecoveryScore = () => {
    if (!wellnessData || wellnessData.length === 0) return null;
    
    const latest = wellnessData[wellnessData.length - 1];
    const recent = wellnessData.slice(-7).filter(d => d.hrvSDNN || d.restingHR);
    
    if (recent.length === 0) return null;
    
    const avgHRV = recent.reduce((sum, d) => sum + (d.hrvSDNN || 0), 0) / recent.length;
    const avgRHR = recent.reduce((sum, d) => sum + (d.restingHR || 0), 0) / recent.length;
    
    const hrvDelta = avgHRV > 0 ? ((latest.hrvSDNN || 0) - avgHRV) / avgHRV * 100 : 0;
    const rhrDelta = avgRHR > 0 ? ((latest.restingHR || 0) - avgRHR) / avgRHR * 100 : 0;
    
    let score = 7;
    
    if (hrvDelta > 5) score += 2;
    else if (hrvDelta > 0) score += 1;
    else if (hrvDelta > -5) score -= 0.5;
    else if (hrvDelta > -10) score -= 1.5;
    else score -= 2.5;
    
    if (rhrDelta < -5) score += 0.5;
    else if (rhrDelta > 10) score -= 1.5;
    else if (rhrDelta > 5) score -= 0.5;
    
    if (athleteData) {
      if (athleteData.yesterday_tsb < -40) score -= 1.5;
      else if (athleteData.yesterday_tsb < -30) score -= 0.5;
    }
    
    return {
      score: Math.max(1, Math.min(10, score)),
      hrvDelta,
      rhrDelta,
      latest
    };
  };

  const recovery = calculateRecoveryScore();

  const getRecommendation = () => {
    if (!recovery) return { status: 'unknown', text: 'Keine Daten', color: 'gray' };
    
    const { score } = recovery;
    
    if (score >= 8) {
      return {
        status: 'GO',
        text: 'Normales Training',
        color: 'green',
        detail: 'HRV und Ruhepuls sind gut. Training wie geplant durchführbar.'
      };
    } else if (score >= 6) {
      return {
        status: 'MODIFY',
        text: 'Training anpassen',
        color: 'yellow',
        detail: 'Erwäge Intensität zu reduzieren oder mehr Z2 statt Intervalle.'
      };
    } else {
      return {
        status: 'RECOVERY',
        text: 'Z1/Z2 empfohlen',
        color: 'orange',
        detail: 'Körper braucht Erholung. Heute nur lockeres Training oder Ruhetag.'
      };
    }
  };

  const recommendation = getRecommendation();

  // Handle chat with Claude Project context
  const handleChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    
    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatLoading(true);
    
    try {
      // Load learnings
      const learnings = JSON.parse(localStorage.getItem('agent_learnings') || '{}');
      
      const context = `Kontext aus Training Agent Project:

Athleten-Daten (Live):
- CTL: ${athleteData?.ctl?.toFixed(0)}
- ATL: ${athleteData?.atl?.toFixed(0)}
- TSB: ${athleteData?.yesterday_tsb?.toFixed(0)}
- Recovery Score: ${recovery?.score?.toFixed(1)}/10
- HRV: ${recovery?.latest?.hrvSDNN}ms (${recovery?.hrvDelta > 0 ? '+' : ''}${recovery?.hrvDelta?.toFixed(1)}%)
- Ruhepuls: ${recovery?.latest?.restingHR}bpm (${recovery?.rhrDelta > 0 ? '+' : ''}${recovery?.rhrDelta?.toFixed(1)}%)

Letzte 5 Aktivitäten:
${recentActivities.slice(-5).map(a => `- ${new Date(a.start_date_local).toLocaleDateString('de-DE')}: ${a.name || 'Training'} (${a.icu_training_load?.toFixed(0) || 'N/A'} TSS, ${(a.moving_time/3600).toFixed(1)}h)`).join('\n')}

Gelernte Präferenzen:
${JSON.stringify(learnings, null, 2)}

WICHTIG: Sei sachlich und kritisch. Analysiere nüchtern. Keine Lobhudelei.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'projects-2024-12-02'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: [
            {
              type: 'text',
              text: context
            }
          ],
          messages: [
            { role: 'user', content: userMsg }
          ]
        })
      });

      const data = await response.json();
      const reply = data.content?.[0]?.text || 'Fehler bei der Antwort.';
      
      // Extract learnings from response
      if (reply.includes('✅ Gespeichert:') || reply.includes('Merke:')) {
        // Simple learning extraction
        const learning = reply.match(/(?:Gespeichert:|Merke:) (.+)/);
        if (learning) {
          learnings.notes = learnings.notes || [];
          learnings.notes.push({
            date: new Date().toISOString().split('T')[0],
            note: learning[1]
          });
          localStorage.setItem('agent_learnings', JSON.stringify(learnings));
        }
      }
      
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Fehler: ${err.message}` 
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Rest of the component... (Dashboard UI - identical to previous version)
  // [Gekürzt für Übersichtlichkeit - vollständiger Code im finalen Package]
  
  return (
    
      {/* Login oder Dashboard - wie vorher */}
    
  );
}
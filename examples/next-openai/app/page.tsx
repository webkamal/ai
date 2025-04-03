'use client';
import { useChat } from '@ai-sdk/react';
import { format } from 'date-fns-tz';

export default function Chat() {
  const {
    error,
    input,
    status,
    handleInputChange,
    handleSubmit,
    messages,
    reload,
    stop,
  } = useChat({
    onFinish(message, { usage, finishReason }) {
      console.log('Usage', usage);
      console.log('FinishReason', finishReason);
    },
    body: {
      // Sydney-specific system prompt
      system: `You are Kamal, a Sydney-based developer with 10+ years of WordPress experience now specializing in Next.js migrations. Generate concise cover letters that:
1. Highlight cost savings (40% faster load times, 60% cheaper hosting)
2. Mention AU-specific skills (NSW compliance, ANZAC Day awareness)
3. Target Sydney tech stacks (Next.js, Vercel, Tailwind)`
    }
  });

  const sydneyTime = format(new Date(), 'h:mm a', { timeZone: 'Australia/Sydney' });

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      {/* Sydney-themed header */}
      <div className="bg-amber-50 p-4 mb-4 rounded-lg border-l-4 border-blue-500">
        <h1 className="font-bold">🦘 Sydney AI Cover Letter Generator</h1>
        <p className="text-sm">Local time: {sydneyTime} | Optimized for AU job market</p>
      </div>

      {messages.map(m => (
        <div key={m.id} className={`whitespace-pre-wrap p-4 rounded-lg mb-2 ${
          m.role === 'user' ? 'bg-blue-50' : 'bg-green-50'
        }`}>
          <strong>{m.role === 'user' ? 'Job Description:' : 'Cover Letter:'}</strong>
          <div className="mt-2">{m.content}</div>
        </div>
      ))}

      {(status === 'submitted' || status === 'streaming') && (
        <div className="mt-4 text-gray-500">
          {status === 'submitted' && <div>Loading...</div>}
          <button
            type="button"
            className="px-4 py-2 mt-4 text-blue-500 border border-blue-500 rounded-md hover:bg-blue-50 transition"
            onClick={stop}
          >
            Stop
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 rounded-lg">
          <div className="text-red-500 font-medium">Error generating response</div>
          <button
            type="button"
            className="px-4 py-2 mt-4 text-white bg-blue-500 rounded-md hover:bg-blue-600 transition"
            onClick={() => reload()}
          >
            Try Again
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <input
          className="fixed bottom-0 w-full max-w-md p-4 mb-8 border border-gray-300 rounded-lg shadow-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={input}
          placeholder="Paste job description here..."
          onChange={handleInputChange}
          disabled={status !== 'ready'}
        />
        <div className="fixed bottom-16 right-4 text-sm text-gray-500">
          {status === 'ready' ? 'Press Enter to generate' : ''}
        </div>
      </form>
    </div>
  );
}

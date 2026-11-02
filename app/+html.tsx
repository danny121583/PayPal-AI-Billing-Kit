import React, { type PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>PayPal AI Billing Kit — Unified MCP Gateway &amp; Sandbox Invoicing</title>
        <meta
          name="description"
          content="Standalone PayPal AI Billing Kit with Unified MCP Agent Interface, Gemini 2.5 Flash Billing AI, and verified PayPal Sandbox Orders, Captures, Receipts & Refunds."
        />
        <meta name="theme-color" content="#003087" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}

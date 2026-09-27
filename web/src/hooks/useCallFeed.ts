import { useEffect, useReducer, useRef, useState } from "react";
import { callSocketUrl, STATIC } from "../api";
import { localEngine } from "../local/engine";
import { feedReducer, initialFeed } from "../lib/feed";
import { isTerminal, type FeedEvent } from "../types";

export type Connection = "connecting" | "open" | "reconnecting" | "closed";

/** Live view of one call: a snapshot on connect, then streamed events. Reconnects on drops. */
export function useCallFeed(callId: string, onEvent?: (event: FeedEvent) => void) {
  const [feed, dispatch] = useReducer(feedReducer, initialFeed);
  const [connection, setConnection] = useState<Connection>("connecting");
  // Raw events for side effects (like voicing practice calls) that don't belong in state.
  const listener = useRef(onEvent);
  listener.current = onEvent;

  useEffect(() => {
    if (STATIC) {
      setConnection("open");
      return localEngine.subscribe(callId, (event) => {
        dispatch(event);
        listener.current?.(event);
      });
    }
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;
    let done = false;

    const connect = () => {
      socket = new WebSocket(callSocketUrl(callId));
      socket.onopen = () => {
        attempts = 0;
        setConnection("open");
      };
      socket.onmessage = (msg) => {
        const event = JSON.parse(msg.data) as FeedEvent;
        dispatch(event);
        listener.current?.(event);
        if (event.type === "error") done = true;
        if (event.type === "snapshot" && isTerminal(event.data.state)) done = true;
      };
      socket.onclose = () => {
        if (done) {
          setConnection("closed");
          return;
        }
        setConnection("reconnecting");
        const delay = Math.min(1000 * 2 ** attempts, 5000);
        attempts += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      done = true;
      window.clearTimeout(retryTimer);
      if (socket) {
        // Detach first so a late close event can't clobber the next effect's state.
        socket.onopen = socket.onmessage = socket.onclose = null;
        socket.close();
      }
    };
  }, [callId]);

  return { ...feed, connection };
}

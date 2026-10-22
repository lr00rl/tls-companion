import { Component, type ReactNode } from "react";
import { tx } from "../i18n/lang";
import { href } from "./route";

// Keeps a render error inside one page so the top bar stays usable. Navigating
// to another hash clears the error; children are not remounted otherwise,
// because the workbench rewrites the hash on every step.
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty app-crash">
        <strong>{tx("This page hit an error", "这个页面出错了")}</strong>
        {error.message}
        <div>
          <a className="btn outline" href={href({ page: "home" })}>
            {tx("Back to home", "回到首页")}
          </a>
        </div>
      </div>
    );
  }
}

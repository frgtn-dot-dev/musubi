import type {
  FormHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { BrandMark } from "~/components/BrandMark";
import { Button, type ButtonProps } from "./Button";
import { classNames } from "./class-names";
import styles from "./primitives.module.css";

type AuthShellProps = {
  /**
   * The second way in, in a column of its own behind a rule. Providers are an
   * alternative to the form, not a step before it, and stacking them above it
   * made them read as the first thing to try.
   */
  aside?: ReactNode;
  children: ReactNode;
  eyebrow: ReactNode;
  footer?: ReactNode;
  introduction: ReactNode;
  /**
   * `stacked` keeps the one-column card at every width. For a flow of short
   * steps the two columns leave the form floating beside two lines of copy.
   */
  layout?: "columns" | "stacked";
  title: ReactNode;
  utility?: ReactNode;
};

export function AuthShell({
  aside,
  children,
  eyebrow,
  footer,
  introduction,
  layout = "columns",
  title,
  utility,
}: AuthShellProps) {
  return (
    <main className={styles.authPage} id="main-content" tabIndex={-1}>
      <span className={styles.pageAmbient} aria-hidden="true">
        結
      </span>
      <header className={styles.authTopBar}>
        <div className={styles.authBrand} aria-label="Musubi">
          <BrandMark aria-hidden="true" focusable="false" />
          <span>MUSUBI</span>
        </div>
        {utility}
      </header>

      <section
        className={styles.authCard}
        aria-labelledby="login-title"
        data-layout={aside ? "split" : layout}
      >
        <div className={styles.authCopy}>
          <p className={styles.pageEyebrow}>{eyebrow}</p>
          <h1 id="login-title">{title}</h1>
          <p className={styles.authIntroduction}>{introduction}</p>
        </div>
        <div className={styles.authContent}>
          {children}
          {footer && !aside ? (
            <div className={styles.authFooter}>{footer}</div>
          ) : null}
        </div>
        {/* The footer follows the aside: with a column of its own it belongs
            under the rule, not stranded below the submit button. */}
        {aside ? (
          <aside className={styles.authAside}>
            {aside}
            {footer ? <div className={styles.authFooter}>{footer}</div> : null}
          </aside>
        ) : null}
      </section>
    </main>
  );
}

export function AuthForm({
  children,
  className,
  ...formProps
}: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form
      {...formProps}
      className={classNames(styles.authForm, className)}
    >
      {children}
    </form>
  );
}

export function AuthMessage({
  children,
  className,
  ...messageProps
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...messageProps}
      className={classNames(styles.authMessage, className)}
      role="alert"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

/** The provider buttons, stacked, in the aside column. */
export function AuthProviders({ children }: { children: ReactNode }) {
  return <div className={styles.authProviders}>{children}</div>;
}

export function AuthSubmit({ className, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      className={classNames(styles.authSubmit, className)}
    />
  );
}

type AuthSwitchProps = {
  action: string;
  children: ReactNode;
  onAction: () => void;
};

export function AuthSwitch({
  action,
  children,
  onAction,
}: AuthSwitchProps) {
  return (
    <p className={styles.authSwitch}>
      <span>{children}</span>
      <Button size="compact" variant="ghost" onClick={onAction}>
        {action}
      </Button>
    </p>
  );
}

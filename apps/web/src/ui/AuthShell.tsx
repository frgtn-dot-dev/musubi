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
  children: ReactNode;
  eyebrow: ReactNode;
  footer?: ReactNode;
  introduction: ReactNode;
  title: ReactNode;
  utility?: ReactNode;
};

export function AuthShell({
  children,
  eyebrow,
  footer,
  introduction,
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

      <section className={styles.authCard} aria-labelledby="login-title">
        <p className={styles.pageEyebrow}>{eyebrow}</p>
        <h1 id="login-title">{title}</h1>
        <p className={styles.authIntroduction}>{introduction}</p>
        {children}
        {footer ? <div className={styles.authFooter}>{footer}</div> : null}
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

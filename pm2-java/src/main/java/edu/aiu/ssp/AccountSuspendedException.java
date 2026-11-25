package edu.aiu.ssp;

/** Raised when a suspended account attempts an action that requires ACTIVE status. */
public class AccountSuspendedException extends IllegalStateException {
  public AccountSuspendedException() {
    super("Account is SUSPENDED");
  }
}

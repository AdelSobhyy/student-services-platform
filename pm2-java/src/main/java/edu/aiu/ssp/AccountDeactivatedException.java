package edu.aiu.ssp;

/** Raised when a deactivated account attempts an action that requires ACTIVE status. */
public class AccountDeactivatedException extends IllegalStateException {
  public AccountDeactivatedException() {
    super("Account is DEACTIVATED");
  }
}

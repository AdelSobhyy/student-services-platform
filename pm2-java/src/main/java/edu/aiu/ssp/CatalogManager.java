package edu.aiu.ssp;

import java.time.*;

public record CatalogManager(ILibraryDB db) {
  public Resource getResource(String id) {
    return db.findResourceById(id);
  }
}

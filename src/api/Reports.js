/**
 * Reports.js — getting data out: a shareable Google Doc per project,
 * and CSV for anything else.
 *
 * The Doc is the answer to "send this to someone who does not use the
 * system": it is a self-contained record of the project at a moment in
 * time, written into the project's own Drive folder.
 */

function exportProjectReport_(projectId, options) {
  var project = getOr404_('projects', projectId, 'Project');
  var opts = options || {};
  var includeEntries = opts.includeEntries === undefined ? true : bool_(opts.includeEntries);
  var includeBudget = opts.includeBudget === undefined ? true : bool_(opts.includeBudget);
  var includeBoms = opts.includeBoms === undefined ? true : bool_(opts.includeBoms);
  var includeFiles = opts.includeFiles === undefined ? true : bool_(opts.includeFiles);

  var stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  var title = [str_(project.code), str_(project.name), '— report', stamp]
    .filter(String).join(' ');

  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();

  body.appendParagraph(str_(project.name)).setHeading(DocumentApp.ParagraphHeading.TITLE);
  var subtitle = body.appendParagraph(
    [str_(project.code), labelFor_(project.status), 'as at ' + stamp].filter(String).join('  ·  ')
  );
  subtitle.setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  if (str_(project.objective)) {
    body.appendParagraph('Objective').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(str_(project.objective));
  }
  if (str_(project.description)) {
    body.appendParagraph('Description').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph(str_(project.description));
  }

  body.appendParagraph('Key dates').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendKeyValues_(body, [
    ['Started', str_(project.startDate) || '—'],
    ['Target', str_(project.targetDate) || '—'],
    ['Closed', str_(project.closedDate) || '—'],
    ['Priority', labelFor_(project.priority)],
    ['Tags', joinTags_(project.tags) || '—']
  ]);

  if (includeBudget) {
    var budget = budgetDetail_(project.id, {});
    var snap = budget.snapshot;
    body.appendParagraph('Budget').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    appendKeyValues_(body, [
      ['Budget', fmtMoney_(snap.budget, snap.currency)],
      ['Spent to date', fmtMoney_(snap.actual, snap.currency)],
      ['Committed (ordered)', fmtMoney_(snap.committed, snap.currency)],
      ['Planned', fmtMoney_(snap.planned, snap.currency)],
      ['Forecast total', fmtMoney_(snap.forecast, snap.currency)],
      ['Remaining against budget', fmtMoney_(snap.remaining, snap.currency)],
      ['Burn rate (3-month mean)', fmtMoney_(budget.burnRate, snap.currency) + ' / month'],
      ['Forecast exhaustion', budget.exhaustedLabel || 'Not within horizon']
    ]);

    if (budget.byCategory.length) {
      var catRows = [['Category', 'Actual', 'Committed', 'Planned', 'Total']];
      budget.byCategory.forEach(function (c) {
        catRows.push([
          c.label, fmtMoney_(c.actual), fmtMoney_(c.committed),
          fmtMoney_(c.planned), fmtMoney_(c.total)
        ]);
      });
      styleTable_(body.appendTable(catRows));
    }
  }

  if (includeBoms) {
    var boms = byField_('boms', 'projectId', project.id);
    if (boms.length) {
      body.appendParagraph('Bills of materials').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      boms.forEach(function (bom) {
        var rollup = bomRollup_(bom.id);
        body.appendParagraph(bom.name + ' — rev ' + bom.revision + ' (' + bom.status + ')')
          .setHeading(DocumentApp.ParagraphHeading.HEADING2);
        body.appendParagraph(
          'Build quantity ' + rollup.totals.buildQty + ' · ' +
          fmtMoney_(rollup.totals.unitCost) + ' per unit · ' +
          fmtMoney_(rollup.totals.buildCost) + ' for the run'
        );
        var rows = [['#', 'Ref', 'Part', 'Qty/unit', 'Required', 'On hand', 'Unit cost', 'Ext cost']];
        rollup.lines.forEach(function (line) {
          rows.push([
            String(line.lineNo), str_(line.refDes),
            str_(line.description || line.itemName),
            String(line.effectiveQtyPer), String(line.required),
            line.onHand === null ? '—' : String(line.onHand),
            fmtMoney_(line.unitCost), fmtMoney_(line.extCost)
          ]);
        });
        styleTable_(body.appendTable(rows));
      });
    }
  }

  if (includeFiles) {
    var files = byField_('files', 'projectId', project.id);
    if (files.length) {
      body.appendParagraph('Files').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      files.sort(function (a, b) {
        return str_(a.category).localeCompare(str_(b.category));
      }).forEach(function (f) {
        var para = body.appendListItem(
          str_(f.name) +
          (str_(f.revision) ? '  (rev ' + f.revision + ')' : '') +
          '  — ' + labelFor_(f.category) + ', ' + humanSize_(f.size)
        );
        para.setGlyphType(DocumentApp.GlyphType.BULLET);
        if (str_(f.url)) {
          para.setLinkUrl(str_(f.url));
        }
      });
    }
  }

  if (includeEntries) {
    var entries = byField_('entries', 'projectId', project.id)
      .sort(function (a, b) { return num_(a.entryNo) - num_(b.entryNo); });

    if (entries.length) {
      body.appendParagraph('Notebook').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      entries.forEach(function (entry) {
        body.appendParagraph('#' + entry.entryNo + '  ' + str_(entry.title))
          .setHeading(DocumentApp.ParagraphHeading.HEADING2);
        body.appendParagraph(
          [str_(entry.date), labelFor_(entry.type),
            str_(entry.signedAt) ? 'signed by ' + str_(entry.signedBy) : 'draft',
            joinTags_(entry.tags)].filter(String).join('  ·  ')
        ).setItalic(true);

        str_(entry.body).split(/\n{2,}/).forEach(function (block) {
          var text = block.trim();
          if (!text) return;
          var heading = /^(#{1,4})\s+(.*)$/.exec(text);
          if (heading) {
            var level = heading[1].length;
            body.appendParagraph(heading[2]).setHeading(
              level <= 2 ? DocumentApp.ParagraphHeading.HEADING3
                : DocumentApp.ParagraphHeading.HEADING4
            );
            return;
          }
          if (/^[-*]\s+/.test(text)) {
            text.split(/\n/).forEach(function (line) {
              var bullet = line.replace(/^[-*]\s+/, '').trim();
              if (bullet) body.appendListItem(bullet).setGlyphType(DocumentApp.GlyphType.BULLET);
            });
            return;
          }
          body.appendParagraph(text);
        });

        var links = entryLinks_(entry.id);
        if (links.length) {
          body.appendParagraph('References').setItalic(true);
          links.forEach(function (link) {
            var item = body.appendListItem(
              labelFor_(link.targetType) + ': ' + str_(link.title) +
              (str_(link.subtitle) ? '  (' + link.subtitle + ')' : '')
            );
            item.setGlyphType(DocumentApp.GlyphType.BULLET);
            if (str_(link.url)) item.setLinkUrl(str_(link.url));
          });
        }
      });
    }
  }

  doc.saveAndClose();

  // File the report beside the project's other material.
  var docFile = DriveApp.getFileById(doc.getId());
  try {
    var folder = ensureProjectFolder_(project);
    folder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  } catch (err) {
    console.warn('could not move report into project folder: ' + err);
  }

  audit_('export', 'project', project.id, 'generated report ' + title);
  return { id: doc.getId(), url: docFile.getUrl(), name: title };
}

function appendKeyValues_(body, pairs) {
  var table = body.appendTable(pairs.map(function (pair) {
    return [str_(pair[0]), str_(pair[1])];
  }));
  table.setBorderWidth(0);
  for (var r = 0; r < table.getNumRows(); r++) {
    table.getRow(r).getCell(0).editAsText().setBold(true);
  }
  return table;
}

function styleTable_(table) {
  table.setBorderWidth(1);
  if (table.getNumRows() > 0) {
    var header = table.getRow(0);
    for (var c = 0; c < header.getNumCells(); c++) {
      header.getCell(c).editAsText().setBold(true);
    }
  }
  return table;
}

/* ------------------------------ CSV ------------------------------- */

/** Export a table (optionally filtered to one project) as CSV text. */
function exportCsv_(tableKey, options) {
  var opts = options || {};
  var allowed = ['projects', 'entries', 'files', 'items', 'txns', 'purchases',
    'boms', 'bomLines', 'recurring', 'audit'];
  var key = str_(tableKey).trim();
  if (allowed.indexOf(key) === -1) {
    fail_('Cannot export "' + key + '". Choose one of: ' + allowed.join(', ') + '.', 'invalid');
  }

  var def = TABLES()[key];
  var columns = def.columns.map(function (c) { return c.name; });
  var rows = all_(key);

  if (opts.projectId && columns.indexOf('projectId') !== -1) {
    rows = rows.filter(function (r) { return str_(r.projectId) === str_(opts.projectId); });
  }

  var lines = [columns.map(csvCell_).join(',')];
  rows.forEach(function (r) {
    lines.push(columns.map(function (c) { return csvCell_(r[c]); }).join(','));
  });

  var stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  return {
    filename: 'lab-notebook-' + slug_(def.sheet) + '-' + stamp + '.csv',
    mimeType: 'text/csv',
    rowCount: rows.length,
    csv: lines.join('\n')
  };
}

function csvCell_(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

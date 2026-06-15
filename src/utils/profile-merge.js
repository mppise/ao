'use strict';

const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSON, ensureDir } = require('./file-io');

/**
 * Map documentType → profile section filename and merge strategy.
 */
const DOC_TYPE_TO_SECTION = {
  transcript: 'academic',
  test_result: 'tests',
  certificate: 'achievements',
  activity: 'activities',
};

/**
 * Get the profile section name for a given documentType.
 * @param {string} documentType
 * @returns {string}
 */
function getSectionForDocType(documentType) {
  return DOC_TYPE_TO_SECTION[documentType] || 'academic';
}

/**
 * Read a profile section JSON file (returns {} or [] wrapped in object if missing).
 * @param {string} dataDir
 * @param {string} section
 * @returns {object}
 */
function readProfileSection(dataDir, section) {
  const filePath = path.join(dataDir, 'profile', `${section}.json`);
  try {
    return readJSON(filePath);
  } catch (_) {
    return _emptyProfile(section);
  }
}

/**
 * Write a profile section JSON file atomically.
 * @param {string} dataDir
 * @param {string} section
 * @param {object} data
 */
function writeProfileSection(dataDir, section, data) {
  const filePath = path.join(dataDir, 'profile', `${section}.json`);
  ensureDir(path.join(dataDir, 'profile'));
  writeJSON(filePath, data);
}

/**
 * Return an empty profile object for a section.
 */
function _emptyProfile(section) {
  switch (section) {
    case 'academic':
      return { gpa: null, gpaScale: null, classRank: null, graduationYear: null, schoolName: null, courses: [], apIbScores: [], disciplinaryNotes: null };
    case 'tests':
      return { sat: null, act: null, ap: [], ib: [], other: [] };
    case 'achievements':
      return { achievements: [] };
    case 'activities':
      return { activities: [] };
    default:
      return {};
  }
}

/**
 * Build a citation object for a persisted field.
 */
function buildCitation(field, sourceDoc, uploadedAt, savedAt) {
  return {
    value: field.value,
    confidence: field.confidence,
    source: sourceDoc,
    sourceUploadedAt: uploadedAt,
    excerpt: field.excerpt || '',
    confirmedByStudent: field.confirmedByStudent || false,
    savedAt,
  };
}

// ─── Field type transformations ───────────────────────────────────────────────

/**
 * Attempt parseFloat. Returns { value, warning } where warning is null on success.
 */
function _parseFloatField(raw, fieldName) {
  if (raw === null || raw === undefined) return { value: null, warning: null };
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return { value: null, warning: `${fieldName}: could not parse '${raw}' as a number — check for OCR error` };
  return { value: n, warning: null };
}

function _parseIntField(raw, fieldName, min, max) {
  if (raw === null || raw === undefined) return { value: null, warning: null };
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  if (isNaN(n)) return { value: null, warning: `${fieldName}: could not parse '${raw}' as an integer` };
  if (min !== undefined && n < min) return { value: null, warning: `${fieldName}: value ${n} is below minimum ${min}` };
  if (max !== undefined && n > max) return { value: null, warning: `${fieldName}: value ${n} exceeds maximum ${max}` };
  return { value: n, warning: null };
}

/**
 * Parse class rank string like "15 of 320" or "15/320" or just "15".
 * Returns { rank, classSize }.
 */
function _parseClassRank(raw) {
  if (raw === null || raw === undefined) return { rank: null, classSize: null };
  const s = String(raw);
  // Try "15 of 320" or "15/320" patterns
  const match = s.match(/^(\d+)\s*(?:of|\/|\s)\s*(\d+)$/i);
  if (match) {
    return { rank: parseInt(match[1], 10), classSize: parseInt(match[2], 10) };
  }
  // Single number
  const n = parseInt(s, 10);
  if (!isNaN(n)) return { rank: n, classSize: null };
  return { rank: null, classSize: null };
}

/**
 * Detect duplicate courses between incoming extraction and existing profile courses.
 * Returns an array of { incomingCourseName, existingCourseIndex } for matched courses.
 * Match key: normalized course name (lowercase, trimmed).
 *
 * @param {Array} existingCourses - courses already in profile
 * @param {Array} incomingCourses - courses from new extraction
 * @returns {Array<{ incomingCourseName: string, existingIdx: number }>}
 */
function detectDuplicateCourses(existingCourses, incomingCourses) {
  if (!Array.isArray(existingCourses) || !Array.isArray(incomingCourses)) return [];
  const duplicates = [];
  for (const incoming of incomingCourses) {
    const incomingKey = String(incoming.name || incoming.courseName || '').toLowerCase().trim();
    if (!incomingKey) continue;
    const existingIdx = existingCourses.findIndex(e => {
      const existingKey = String(e.name || e.courseName || '').toLowerCase().trim();
      return existingKey === incomingKey;
    });
    if (existingIdx !== -1) {
      duplicates.push({ incomingCourseName: incoming.name || incoming.courseName, existingIdx });
    }
  }
  return duplicates;
}

/**
 * Validate and normalise the courses array from Gemini.
 * Accepts array of objects with name/grade/score/term/level fields.
 * Also accepts legacy objects with courseName field.
 */
function _normalizeCourses(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { return []; }
    } else {
      return [];
    }
  }
  return raw.map(c => ({
    name: String(c.name || c.courseName || '').trim(),
    grade: (c.grade !== undefined && c.grade !== null) ? String(c.grade) : null,
    score: (c.score !== undefined && c.score !== null) ? parseFloat(c.score) || null : null,
    term: (c.term !== undefined && c.term !== null) ? String(c.term) : null,
    level: (c.level !== undefined && c.level !== null && String(c.level).trim() !== '') ? String(c.level) : null,
  })).filter(c => c.name);
}

/**
 * Merge extracted fields into a profile section JSON.
 *
 * Strategy:
 *  - Skip fields where skipped:true or deleted:true
 *  - For scalar fields that already exist in the profile: wrap in sources[] array (merge conflict strategy)
 *  - For array fields (courses, achievements, activities, ap, ib, other): append
 *
 * @param {string} dataDir
 * @param {string} documentType - one of: transcript, test_result, certificate, activity
 * @param {Array} fields - array of field objects from extraction (with value, confidence, excerpt, confirmedByStudent, skipped)
 * @param {string} sourceDoc - original filename of the document
 * @param {string} sourceUploadedAt - ISO timestamp when doc was uploaded
 * @param {object} [options] - optional merge options
 * @param {string} [options.coursesMergeMode] - 'merge' or 'add_new' (default: 'add_new')
 * @param {string} [options.documentId] - UUID of the source document (for source tracking on courses, achievements, activities)
 * @returns {{ section: string, fieldsSaved: number, fieldsSkipped: number, fieldsDeleted: number, transformWarnings: string[], duplicatesDetected: number }}
 */
function mergeExtractedData(dataDir, documentType, fields, sourceDoc, sourceUploadedAt, options) {
  // Capture documentId from options for source tracking
  const _documentId = (options && options.documentId) || null;
  const section = getSectionForDocType(documentType);
  const profile = readProfileSection(dataDir, section);
  const savedAt = new Date().toISOString();

  const coursesMergeMode = (options && options.coursesMergeMode) || 'add_new';
  let fieldsSaved = 0;
  let fieldsSkipped = 0;
  let fieldsDeleted = 0;
  let duplicatesDetected = 0;
  const transformWarnings = [];

  if (section === 'academic') {
    // Ensure apIbScores is always present
    if (!Array.isArray(profile.apIbScores)) profile.apIbScores = [];

    for (const field of fields) {
      if (field.deleted) { fieldsDeleted++; continue; }
      if (field.skipped) { fieldsSkipped++; continue; }

      const citation = buildCitation(field, sourceDoc, sourceUploadedAt, savedAt);

      switch (field.name) {
        case 'gpa_overall': {
          const { value: parsed, warning } = _parseFloatField(field.value, 'gpa_overall');
          if (warning) { transformWarnings.push(warning); continue; }
          const citWithVal = { ...citation, value: parsed };
          if (profile.gpa && profile.gpa.overall !== undefined) {
            if (!profile.gpa.sources) {
              profile.gpa.sources = [];
              if (profile.gpa.overall !== null) profile.gpa.sources.push({ ...profile.gpa.overall });
            }
            profile.gpa.sources.push(citWithVal);
          } else {
            if (!profile.gpa) profile.gpa = {};
            profile.gpa.overall = citWithVal;
          }
          fieldsSaved++;
          break;
        }
        case 'gpa_scale': {
          const { value: parsed, warning } = _parseFloatField(field.value, 'gpa_scale');
          const finalVal = (parsed === null && warning === null) ? 4.0 : parsed;
          if (warning) { transformWarnings.push(warning); continue; }
          const citWithVal = { ...citation, value: finalVal };
          if (profile.gpaScale !== null && profile.gpaScale !== undefined) {
            if (!profile.gpaScaleSources) profile.gpaScaleSources = [profile.gpaScale];
            profile.gpaScaleSources.push(citWithVal);
          } else {
            profile.gpaScale = citWithVal;
          }
          fieldsSaved++;
          break;
        }
        case 'class_rank': {
          const { rank, classSize } = _parseClassRank(field.value);
          const rankCitation = {
            rank,
            classSize,
            confidence: field.confidence,
            source: sourceDoc,
            sourceUploadedAt,
            excerpt: field.excerpt || '',
            confirmedByStudent: field.confirmedByStudent || false,
            savedAt,
          };
          if (profile.classRank !== null && profile.classRank !== undefined) {
            if (!profile.classRankSources) profile.classRankSources = [profile.classRank];
            profile.classRankSources.push(rankCitation);
          } else {
            profile.classRank = rankCitation;
          }
          fieldsSaved++;
          break;
        }
        case 'graduation_year': {
          const { value: parsed, warning } = _parseIntField(field.value, 'graduation_year');
          if (warning || (parsed !== null && (String(parsed).length !== 4))) {
            transformWarnings.push(`graduation_year: value '${field.value}' is not a valid 4-digit year`);
            continue;
          }
          const citWithVal = { ...citation, value: parsed };
          if (profile.graduationYear !== null && profile.graduationYear !== undefined) {
            if (!profile.graduationYearSources) profile.graduationYearSources = [profile.graduationYear];
            profile.graduationYearSources.push(citWithVal);
          } else {
            profile.graduationYear = citWithVal;
          }
          fieldsSaved++;
          break;
        }
        case 'school_name': {
          const citWithVal = { ...citation, value: String(field.value || '') };
          if (profile.schoolName !== null && profile.schoolName !== undefined) {
            if (!profile.schoolNameSources) profile.schoolNameSources = [profile.schoolName];
            profile.schoolNameSources.push(citWithVal);
          } else {
            profile.schoolName = citWithVal;
          }
          fieldsSaved++;
          break;
        }
        case 'disciplinary_notes': {
          profile.disciplinaryNotes = { ...citation, value: field.value !== undefined ? field.value : null };
          fieldsSaved++;
          break;
        }
        case 'courses': {
          if (!Array.isArray(profile.courses)) profile.courses = [];
          const courses = _normalizeCourses(field.value);
          if (courses.length === 0 && field.value !== null) {
            transformWarnings.push('courses: could not parse courses array — check extraction data');
          }
          for (const course of courses) {
            const courseKey = String(course.name || '').toLowerCase().trim();
            const existingIdx = profile.courses.findIndex(e =>
              String(e.name || e.courseName || '').toLowerCase().trim() === courseKey
            );

            if (existingIdx !== -1 && coursesMergeMode === 'merge') {
              // Merge: update only changed fields on existing course entry
              const existing = profile.courses[existingIdx];
              if (course.grade !== null && course.grade !== undefined) existing.grade = course.grade;
              if (course.score !== null && course.score !== undefined) existing.score = course.score;
              if (course.term !== null && course.term !== undefined) existing.term = course.term;
              if (course.level !== null && course.level !== undefined) existing.level = course.level;
              // Preserve source as proper object (not string) for correct badge display
              existing.source = {
                type: 'extracted',
                documentId: _documentId,
                documentName: sourceDoc,
                extractedAt: savedAt,
              };
              existing.sourceUploadedAt = sourceUploadedAt;
              existing.savedAt = savedAt;
              duplicatesDetected++;
              fieldsSaved++;
            } else {
              // Add as new (even if duplicate when mode is 'add_new')
              profile.courses.push({
                id: crypto.randomUUID(),
                name: course.name,
                grade: course.grade,
                score: course.score,
                term: course.term,
                level: course.level,
                confidence: field.confidence,
                source: {
                  type: 'extracted',
                  documentId: _documentId,
                  documentName: sourceDoc,
                  extractedAt: savedAt,
                },
                sourceUploadedAt,
                excerpt: field.excerpt || '',
                confirmedByStudent: field.confirmedByStudent || false,
                savedAt,
              });
              fieldsSaved++;
            }
          }
          break;
        }
        default:
          if (!profile.extras) profile.extras = {};
          profile.extras[field.name] = citation;
          fieldsSaved++;
      }
    }

  } else if (section === 'tests') {
    // Ensure sat and act have proper nested score objects
    let satConfidence = 0;
    let satSource = null;
    let satExcerpt = '';
    let satConfirmed = false;
    let satUploadedAt = sourceUploadedAt;

    for (const field of fields) {
      if (field.deleted) { fieldsDeleted++; continue; }
      if (field.skipped) { fieldsSkipped++; continue; }

      switch (field.name) {
        case 'sat_math': {
          const { value: parsed, warning } = _parseIntField(field.value, 'sat_math', 200, 800);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.sat) profile.sat = { score: {}, dateTaken: null };
          if (!profile.sat.score) profile.sat.score = {};
          profile.sat.score.math = parsed;
          if (field.confidence > satConfidence) {
            satConfidence = field.confidence;
            satSource = sourceDoc;
            satExcerpt = field.excerpt || '';
            satConfirmed = field.confirmedByStudent || false;
            satUploadedAt = sourceUploadedAt;
          }
          fieldsSaved++;
          break;
        }
        case 'sat_ebrw': {
          const { value: parsed, warning } = _parseIntField(field.value, 'sat_ebrw', 200, 800);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.sat) profile.sat = { score: {}, dateTaken: null };
          if (!profile.sat.score) profile.sat.score = {};
          profile.sat.score.ebrw = parsed;
          if (field.confidence > satConfidence) {
            satConfidence = field.confidence;
            satSource = sourceDoc;
            satExcerpt = field.excerpt || '';
            satConfirmed = field.confirmedByStudent || false;
          }
          fieldsSaved++;
          break;
        }
        case 'sat_total': {
          const { value: parsed, warning } = _parseIntField(field.value, 'sat_total', 400, 1600);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.sat) profile.sat = { score: {}, dateTaken: null };
          if (!profile.sat.score) profile.sat.score = {};
          // Compute from parts if missing
          const total = parsed !== null ? parsed : (
            (profile.sat.score.math && profile.sat.score.ebrw)
              ? (profile.sat.score.math + profile.sat.score.ebrw)
              : null
          );
          profile.sat.score.total = total;
          if (field.confidence > satConfidence) {
            satConfidence = field.confidence;
            satSource = sourceDoc;
            satExcerpt = field.excerpt || '';
            satConfirmed = field.confirmedByStudent || false;
          }
          fieldsSaved++;
          break;
        }
        case 'sat_date': {
          if (!profile.sat) profile.sat = { score: {}, dateTaken: null };
          profile.sat.dateTaken = field.value ? String(field.value) : null;
          fieldsSaved++;
          break;
        }
        case 'act_english': {
          const { value: parsed, warning } = _parseIntField(field.value, 'act_english', 1, 36);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.act) profile.act = { score: {}, dateTaken: null };
          if (!profile.act.score) profile.act.score = {};
          profile.act.score.english = parsed;
          fieldsSaved++;
          break;
        }
        case 'act_math': {
          const { value: parsed, warning } = _parseIntField(field.value, 'act_math', 1, 36);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.act) profile.act = { score: {}, dateTaken: null };
          if (!profile.act.score) profile.act.score = {};
          profile.act.score.math = parsed;
          fieldsSaved++;
          break;
        }
        case 'act_reading': {
          const { value: parsed, warning } = _parseIntField(field.value, 'act_reading', 1, 36);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.act) profile.act = { score: {}, dateTaken: null };
          if (!profile.act.score) profile.act.score = {};
          profile.act.score.reading = parsed;
          fieldsSaved++;
          break;
        }
        case 'act_science': {
          const { value: parsed, warning } = _parseIntField(field.value, 'act_science', 1, 36);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.act) profile.act = { score: {}, dateTaken: null };
          if (!profile.act.score) profile.act.score = {};
          profile.act.score.science = parsed;
          fieldsSaved++;
          break;
        }
        case 'act_composite': {
          const { value: parsed, warning } = _parseIntField(field.value, 'act_composite', 1, 36);
          if (warning) { transformWarnings.push(warning); continue; }
          if (!profile.act) profile.act = { score: {}, dateTaken: null };
          if (!profile.act.score) profile.act.score = {};
          let composite = parsed;
          if (composite === null && profile.act.score.english && profile.act.score.math && profile.act.score.reading && profile.act.score.science) {
            composite = Math.round((profile.act.score.english + profile.act.score.math + profile.act.score.reading + profile.act.score.science) / 4);
          }
          profile.act.score.composite = composite;
          fieldsSaved++;
          break;
        }
        case 'act_date': {
          if (!profile.act) profile.act = { score: {}, dateTaken: null };
          profile.act.dateTaken = field.value ? String(field.value) : null;
          fieldsSaved++;
          break;
        }
        case 'ap_scores':
          if (!Array.isArray(profile.ap)) profile.ap = [];
          if (Array.isArray(field.value)) {
            for (const entry of field.value) {
              const scoreInt = parseInt(entry.score, 10);
              if (isNaN(scoreInt) || scoreInt < 1 || scoreInt > 5) {
                transformWarnings.push(`ap_scores: score ${entry.score} for '${entry.examName}' is not 1–5`);
                continue;
              }
              profile.ap.push({
                examName: String(entry.examName || ''),
                score: scoreInt,
                dateTaken: entry.date || null,
                confidence: field.confidence,
                source: sourceDoc,
                sourceUploadedAt,
                excerpt: field.excerpt || '',
                confirmedByStudent: field.confirmedByStudent || false,
                savedAt,
              });
              fieldsSaved++;
            }
          }
          break;
        case 'ib_scores':
          if (!Array.isArray(profile.ib)) profile.ib = [];
          if (Array.isArray(field.value)) {
            for (const entry of field.value) {
              const scoreInt = parseInt(entry.score, 10);
              if (isNaN(scoreInt) || scoreInt < 1 || scoreInt > 7) {
                transformWarnings.push(`ib_scores: score ${entry.score} for '${entry.subject}' is not 1–7`);
                continue;
              }
              profile.ib.push({
                subject: String(entry.subject || ''),
                level: entry.level || '',
                score: scoreInt,
                dateTaken: entry.date || null,
                confidence: field.confidence,
                source: sourceDoc,
                sourceUploadedAt,
                excerpt: field.excerpt || '',
                confirmedByStudent: field.confirmedByStudent || false,
                savedAt,
              });
              fieldsSaved++;
            }
          }
          break;
        case 'other_exam':
          if (!Array.isArray(profile.other)) profile.other = [];
          profile.other.push({
            examName: field.value && field.value.examName ? field.value.examName : String(field.value || ''),
            results: field.value && field.value.results ? field.value.results : null,
            dateTaken: field.value && field.value.date ? field.value.date : null,
            confidence: field.confidence,
            source: sourceDoc,
            sourceUploadedAt,
            excerpt: field.excerpt || '',
            confirmedByStudent: field.confirmedByStudent || false,
            savedAt,
          });
          fieldsSaved++;
          break;
        default:
          if (!profile.extras) profile.extras = {};
          profile.extras[field.name] = buildCitation(field, sourceDoc, sourceUploadedAt, savedAt);
          fieldsSaved++;
      }
    }

    // After processing all SAT fields, apply shared metadata to sat object
    if (profile.sat && satSource) {
      profile.sat.confidence = satConfidence;
      profile.sat.source = satSource;
      profile.sat.sourceUploadedAt = satUploadedAt;
      profile.sat.excerpt = satExcerpt;
      profile.sat.confirmedByStudent = satConfirmed;
      profile.sat.savedAt = savedAt;
      // Compute total from parts if not explicitly set
      if (profile.sat.score && profile.sat.score.total === undefined && profile.sat.score.math && profile.sat.score.ebrw) {
        profile.sat.score.total = profile.sat.score.math + profile.sat.score.ebrw;
      }
    }

  } else if (section === 'achievements') {
    if (!Array.isArray(profile.achievements)) profile.achievements = [];
    // Accumulate all non-skipped, non-deleted fields for one achievement entry
    const entry = {
      id: crypto.randomUUID(),
      confidence: 0,
      source: {
        type: 'extracted',
        documentId: _documentId,
        documentName: sourceDoc,
        extractedAt: savedAt,
      },
      sourceUploadedAt,
      savedAt,
    };
    let hasData = false;

    for (const field of fields) {
      if (field.deleted) { fieldsDeleted++; continue; }
      if (field.skipped) { fieldsSkipped++; continue; }

      // Skip recipient_name per FERPA constraint
      if (field.name === 'recipient_name') { fieldsSkipped++; continue; }

      switch (field.name) {
        case 'award_name':
          entry.awardName = field.value;
          entry.title = field.value; // Both set to same value per spec
          entry.confidence = Math.max(entry.confidence, field.confidence);
          hasData = true;
          break;
        case 'issuing_organization': entry.issuingOrganization = field.value; hasData = true; break;
        case 'date_awarded': entry.dateAwarded = field.value; hasData = true; break;
        case 'award_category': {
          const validCats = ['academic', 'sports', 'arts', 'community_service', 'leadership', 'stem', 'other'];
          entry.category = validCats.includes(field.value) ? field.value : 'other';
          hasData = true;
          break;
        }
      }
      entry.excerpt = entry.excerpt || field.excerpt || '';
      entry.confirmedByStudent = entry.confirmedByStudent || field.confirmedByStudent || false;
      fieldsSaved++;
    }

    if (hasData) {
      // Assemble description from parts
      const parts = [];
      if (entry.awardName) parts.push(entry.awardName);
      if (entry.issuingOrganization) parts.push(`awarded by ${entry.issuingOrganization}`);
      if (entry.dateAwarded) parts.push(`on ${entry.dateAwarded}`);
      entry.description = parts.length > 0 ? parts.join(' ') + '.' : '';

      profile.achievements.push(entry);
    }

  } else if (section === 'activities') {
    if (!Array.isArray(profile.activities)) profile.activities = [];
    const entry = {
      id: crypto.randomUUID(),
      confidence: 0,
      source: {
        type: 'extracted',
        documentId: _documentId,
        documentName: sourceDoc,
        extractedAt: savedAt,
      },
      sourceUploadedAt,
      savedAt,
    };
    let hasData = false;

    for (const field of fields) {
      if (field.deleted) { fieldsDeleted++; continue; }
      if (field.skipped) { fieldsSkipped++; continue; }

      switch (field.name) {
        case 'activity_name':
          entry.activityName = field.value;
          entry.title = field.value; // Both set to same value per spec
          entry.confidence = Math.max(entry.confidence, field.confidence);
          hasData = true;
          break;
        case 'role': entry.role = field.value; hasData = true; break;
        case 'organization': entry.organization = field.value; hasData = true; break;
        case 'hours_per_week': {
          entry.hoursPerWeek = (field.value !== null && field.value !== undefined) ? parseFloat(field.value) || null : null;
          hasData = true;
          break;
        }
        case 'duration': entry.duration = field.value; hasData = true; break;
        case 'date_start': entry.dateStart = field.value; hasData = true; break;
        case 'date_end': entry.dateEnd = field.value; hasData = true; break;
      }
      entry.excerpt = entry.excerpt || field.excerpt || '';
      entry.confirmedByStudent = entry.confirmedByStudent || field.confirmedByStudent || false;
      fieldsSaved++;
    }

    if (hasData) {
      // Assemble description
      const rolePart = entry.role ? `${entry.role} at ` : '';
      const orgName = entry.organization || entry.activityName || '';
      const hoursPart = entry.hoursPerWeek ? `${entry.hoursPerWeek} hours/week, ` : '';
      const durPart = entry.duration || '';
      entry.description = `${rolePart}${orgName}${entry.activityName && orgName !== entry.activityName ? ` — ${entry.activityName}` : ''}. ${hoursPart}${durPart}.`.replace(/\. \.$/, '.').trim();

      profile.activities.push(entry);
    }
  }

  profile.lastUpdated = savedAt;
  writeProfileSection(dataDir, section, profile);

  return { section, fieldsSaved, fieldsSkipped, fieldsDeleted, transformWarnings, duplicatesDetected };
}

module.exports = {
  getSectionForDocType,
  readProfileSection,
  writeProfileSection,
  mergeExtractedData,
  detectDuplicateCourses,
};
